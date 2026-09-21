@IsTest
private class SfPiFlowSliceOneRuntimeTest {
    @IsTest
    static void returnsOneActionResultForOneSuccessfulRequest() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            SfPiFlowFaultAction.Request request = new SfPiFlowFaultAction.Request();
            request.shouldFail = false;
            request.marker = 'SFPI-ACTION-SUCCESS';

            Test.startTest();
            List<SfPiFlowFaultAction.Result> results = SfPiFlowFaultAction.execute(
                new List<SfPiFlowFaultAction.Request>{ request }
            );
            List<SfPiFlowFaultAction.Result> nullResults = SfPiFlowFaultAction.execute(null);
            Test.stopTest();

            Assert.areEqual(1, results.size());
            Assert.areEqual('SFPI-ACTION-SUCCESS', results[0].marker);
            Assert.areEqual(0, nullResults.size());
        }
    }

    @IsTest
    static void entersTheRealActionAndDatabaseFaultConnectors() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Flow.Interview actionInterview = Flow.Interview.createInterview(
                'SfPi_Advanced_Forced_Faults',
                new Map<String, Object>{
                    'faultMode' => 'action',
                    'inputKey' => 'SFPI-ACTION-FAULT'
                }
            );
            Flow.Interview databaseInterview = Flow.Interview.createInterview(
                'SfPi_Advanced_Forced_Faults',
                new Map<String, Object>{
                    'faultMode' => 'database',
                    'inputKey' => 'SFPI-DATABASE-FAULT'
                }
            );

            Test.startTest();
            actionInterview.start();
            databaseInterview.start();
            Test.stopTest();

            Assert.areEqual('action', actionInterview.getVariableValue('faultKind'));
            Assert.isFalse(String.isBlank((String) actionInterview.getVariableValue('faultMessage')));
            Assert.isNull(actionInterview.getVariableValue('unexpectedSuccess'));
            Assert.areEqual('database', databaseInterview.getVariableValue('faultKind'));
            Assert.isFalse(String.isBlank((String) databaseInterview.getVariableValue('faultMessage')));
            Assert.isNull(databaseInterview.getVariableValue('unexpectedSuccess'));
            Assert.areEqual(
                0,
                [SELECT COUNT() FROM SfPi_Flow_Probe__c WHERE CorrelationKey__c = 'SFPI-DATABASE-FAULT'],
                'The rejected database record must not persist.'
            );
        }
    }

    @IsTest
    static void deletesOnlyTheRelatedRecordsMatchingTheCorrelationKey() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            SfPi_Flow_Probe__c parent = new SfPi_Flow_Probe__c(Name = 'Parent');
            insert parent;
            insert new List<SfPi_Flow_Probe__c>{
                new SfPi_Flow_Probe__c(Name = 'Delete One', Parent__c = parent.Id, CorrelationKey__c = 'SFPI-DELETE'),
                new SfPi_Flow_Probe__c(Name = 'Delete Two', Parent__c = parent.Id, CorrelationKey__c = 'SFPI-DELETE'),
                new SfPi_Flow_Probe__c(Name = 'Keep', Parent__c = parent.Id, CorrelationKey__c = 'SFPI-KEEP')
            };
            Flow.Interview interview = Flow.Interview.createInterview(
                'SfPi_Advanced_Related_Delete',
                new Map<String, Object>{
                    'parentId' => String.valueOf(parent.Id),
                    'inputKey' => 'SFPI-DELETE'
                }
            );

            Test.startTest();
            interview.start();
            Test.stopTest();

            Assert.areEqual(true, interview.getVariableValue('completed'));
            Assert.isNull(interview.getVariableValue('faultMessage'));
            List<SfPi_Flow_Probe__c> remaining = [
                SELECT Name, CorrelationKey__c
                FROM SfPi_Flow_Probe__c
                WHERE Parent__c = :parent.Id
            ];
            Assert.areEqual(1, remaining.size());
            Assert.areEqual('Keep', remaining[0].Name);
            Assert.areEqual('SFPI-KEEP', remaining[0].CorrelationKey__c);
        }
    }

    @IsTest
    static void createsUpdatesAndDeletesThroughOneRecordCollectionVariable() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            String key = 'SFPI-RECORD-COLLECTION';
            List<SfPi_Flow_Probe__c> records = new List<SfPi_Flow_Probe__c>{
                new SfPi_Flow_Probe__c(Name = 'First', CorrelationKey__c = key, Stage__c = 'created'),
                new SfPi_Flow_Probe__c(Name = 'Second', CorrelationKey__c = key, Stage__c = 'created')
            };

            Test.startTest();
            Flow.Interview createInterview = runRecordOperation('create', records);
            Assert.areEqual(true, createInterview.getVariableValue('completed'));
            Assert.isNull(createInterview.getVariableValue('faultMessage'));

            List<SfPi_Flow_Probe__c> persisted = [
                SELECT Id, Name, Stage__c
                FROM SfPi_Flow_Probe__c
                WHERE CorrelationKey__c = :key
                ORDER BY Name
            ];
            Assert.areEqual(2, persisted.size());
            for (SfPi_Flow_Probe__c record : persisted) {
                record.Stage__c = 'updated';
            }

            Flow.Interview updateInterview = runRecordOperation('update', persisted);
            Assert.areEqual(true, updateInterview.getVariableValue('completed'));
            Assert.areEqual(
                2,
                [SELECT COUNT() FROM SfPi_Flow_Probe__c WHERE CorrelationKey__c = :key AND Stage__c = 'updated']
            );

            Flow.Interview deleteInterview = runRecordOperation(
                'delete',
                new List<SfPi_Flow_Probe__c>{ persisted[0] }
            );
            Assert.areEqual(true, deleteInterview.getVariableValue('completed'));
            Assert.areEqual(1, [SELECT COUNT() FROM SfPi_Flow_Probe__c WHERE CorrelationKey__c = :key]);
            Test.stopTest();
        }
    }

    @IsTest
    static void createsThenUpdatesOneRecordByExternalKey() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            String key = 'SFPI-UPSERT-ONE';
            SfPi_Flow_Probe__c createInput = new SfPi_Flow_Probe__c(
                Name = 'Created by Upsert',
                CorrelationKey__c = key,
                ExternalKey__c = key,
                Stage__c = 'created'
            );

            Test.startTest();
            Flow.Interview createInterview = runUpsert(createInput);
            Assert.areEqual(true, createInterview.getVariableValue('completed'));
            Assert.isNull(createInterview.getVariableValue('faultMessage'));
            SfPi_Flow_Probe__c created = [
                SELECT Id, Name, Stage__c
                FROM SfPi_Flow_Probe__c
                WHERE ExternalKey__c = :key
            ];

            SfPi_Flow_Probe__c updateInput = new SfPi_Flow_Probe__c(
                Name = 'Updated by Upsert',
                CorrelationKey__c = key,
                ExternalKey__c = key,
                Stage__c = 'updated'
            );
            Flow.Interview updateInterview = runUpsert(updateInput);
            Test.stopTest();

            Assert.areEqual(true, updateInterview.getVariableValue('completed'));
            Assert.isNull(updateInterview.getVariableValue('faultMessage'));
            List<SfPi_Flow_Probe__c> records = [
                SELECT Id, Name, Stage__c
                FROM SfPi_Flow_Probe__c
                WHERE ExternalKey__c = :key
            ];
            Assert.areEqual(1, records.size());
            Assert.areEqual(created.Id, records[0].Id);
            Assert.areEqual('Updated by Upsert', records[0].Name);
            Assert.areEqual('updated', records[0].Stage__c);
        }
    }

    @IsTest
    static void savesValidMembersWhenCollectionUpsertAllowsPartialSuccess() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            String key = 'SFPI-UPSERT-PARTIAL';
            List<SfPi_Flow_Probe__c> records = upsertFailureFixture(key);

            Test.startTest();
            Flow.Interview interview = runCollectionUpsert('partial', records);
            Test.stopTest();

            Assert.areEqual('partial-fault', interview.getVariableValue('outcome'));
            Assert.isFalse(String.isBlank((String) interview.getVariableValue('faultMessage')));
            List<SfPi_Flow_Probe__c> saved = [
                SELECT ExternalKey__c, Reject__c
                FROM SfPi_Flow_Probe__c
                WHERE CorrelationKey__c = :key
            ];
            Assert.areEqual(1, saved.size());
            Assert.areEqual(key + '-VALID', saved[0].ExternalKey__c);
            Assert.areEqual(false, saved[0].Reject__c);
        }
    }

    @IsTest
    static void rollsBackEveryMemberWhenCollectionUpsertIsAllOrNone() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            String key = 'SFPI-UPSERT-ALL';
            List<SfPi_Flow_Probe__c> records = upsertFailureFixture(key);

            Test.startTest();
            Flow.Interview interview = runCollectionUpsert('all-or-none', records);
            Test.stopTest();

            Assert.areEqual('all-or-none-fault', interview.getVariableValue('outcome'));
            Assert.isFalse(String.isBlank((String) interview.getVariableValue('faultMessage')));
            Assert.areEqual(
                0,
                [SELECT COUNT() FROM SfPi_Flow_Probe__c WHERE CorrelationKey__c = :key]
            );
        }
    }

    @IsTest
    static void countsAndSumsTransformCollectionsIncludingEmptyInput() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            List<SfPi_Flow_Probe__c> records = new List<SfPi_Flow_Probe__c>{
                new SfPi_Flow_Probe__c(Name = 'One', Sequence__c = 1),
                new SfPi_Flow_Probe__c(Name = 'Two', Sequence__c = 2),
                new SfPi_Flow_Probe__c(Name = 'Three', Sequence__c = 3)
            };

            Test.startTest();
            SfPi_Flow_Probe__c aggregate = runTransformAggregate(records);
            SfPi_Flow_Probe__c emptyAggregate = runTransformAggregate(
                new List<SfPi_Flow_Probe__c>()
            );
            Test.stopTest();

            Assert.areEqual(3, aggregate.Count__c);
            Assert.areEqual(6, aggregate.Total__c);
            Assert.areEqual(0, emptyAggregate.Count__c);
            Assert.areEqual(0, emptyAggregate.Total__c);
        }
    }

    @IsTest
    static void innerJoinsMatchedKeysAndExcludesUnmatchedRecords() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            List<SfPi_Flow_Probe__c> leftRecords = new List<SfPi_Flow_Probe__c>{
                new SfPi_Flow_Probe__c(Name = 'Left A', ExternalKey__c = 'JOIN-A'),
                new SfPi_Flow_Probe__c(Name = 'Left B', ExternalKey__c = 'JOIN-B'),
                new SfPi_Flow_Probe__c(Name = 'Left Only', ExternalKey__c = 'JOIN-LEFT')
            };
            List<SfPi_Flow_Probe__c> rightRecords = new List<SfPi_Flow_Probe__c>{
                new SfPi_Flow_Probe__c(Stage__c = 'Right B', ExternalKey__c = 'JOIN-B'),
                new SfPi_Flow_Probe__c(Stage__c = 'Right A', ExternalKey__c = 'JOIN-A'),
                new SfPi_Flow_Probe__c(Stage__c = 'Right Only', ExternalKey__c = 'JOIN-RIGHT')
            };

            Test.startTest();
            List<SfPi_Flow_Probe__c> joined = runTransformJoin(leftRecords, rightRecords);
            Test.stopTest();

            Assert.areEqual(2, joined.size());
            Map<String, String> stageByName = new Map<String, String>();
            for (SfPi_Flow_Probe__c record : joined) {
                stageByName.put(record.Name, record.Stage__c);
            }
            Assert.areEqual('Right A', stageByName.get('Left A'));
            Assert.areEqual('Right B', stageByName.get('Left B'));
            Assert.isFalse(stageByName.containsKey('Left Only'));
            Assert.isFalse(stageByName.values().contains('Right Only'));
        }
    }

    @IsTest
    static void preservesNestedApexDefinedCollectionsWithTransform() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            SfPiFlowNestedChild alpha = new SfPiFlowNestedChild();
            alpha.value = 'Alpha';
            SfPiFlowNestedChild beta = new SfPiFlowNestedChild();
            beta.value = 'Beta';
            SfPiFlowNestedChild gamma = new SfPiFlowNestedChild();
            gamma.value = 'Gamma';
            SfPiFlowNestedParent first = new SfPiFlowNestedParent();
            first.label = 'First';
            first.children = new List<SfPiFlowNestedChild>{ alpha, beta };
            SfPiFlowNestedParent second = new SfPiFlowNestedParent();
            second.label = 'Second';
            second.children = new List<SfPiFlowNestedChild>{ gamma };

            Test.startTest();
            List<SfPiFlowNestedParent> output = runNestedTransform(
                new List<SfPiFlowNestedParent>{ first, second }
            );
            Test.stopTest();

            Assert.areEqual(2, output.size());
            Map<String, Set<String>> valuesByLabel = new Map<String, Set<String>>();
            for (SfPiFlowNestedParent parent : output) {
                Set<String> values = new Set<String>();
                for (SfPiFlowNestedChild child : parent.children) {
                    values.add(child.value);
                }
                valuesByLabel.put(parent.label, values);
            }
            Assert.areEqual(new Set<String>{ 'Alpha', 'Beta' }, valuesByLabel.get('First'));
            Assert.areEqual(new Set<String>{ 'Gamma' }, valuesByLabel.get('Second'));
        }
    }

    @IsTest
    static void sortsByThreeFieldsWithNullsFirstAndLast() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Test.startTest();
            List<String> nullsFirst = sortedNames(true);
            List<String> nullsLast = sortedNames(false);
            Test.stopTest();

            Assert.areEqual(
                new List<String>{ 'Blank High', 'Null Low', 'Alpha High A', 'Alpha High B', 'Alpha Low', 'Zulu' },
                nullsFirst
            );
            Assert.areEqual(
                new List<String>{ 'Alpha High A', 'Alpha High B', 'Alpha Low', 'Zulu', 'Blank High', 'Null Low' },
                nullsLast
            );
        }
    }

    private static List<SfPi_Flow_Probe__c> runTransformJoin(
        List<SfPi_Flow_Probe__c> leftRecords,
        List<SfPi_Flow_Probe__c> rightRecords
    ) {
        Flow.Interview interview = Flow.Interview.createInterview(
            'SfPi_Advanced_Transform_Join',
            new Map<String, Object>{
                'leftRecords' => leftRecords,
                'rightRecords' => rightRecords
            }
        );
        interview.start();
        return (List<SfPi_Flow_Probe__c>) interview.getVariableValue('outputRecords');
    }

    private static List<SfPiFlowNestedParent> runNestedTransform(
        List<SfPiFlowNestedParent> parents
    ) {
        Flow.Interview interview = Flow.Interview.createInterview(
            'SfPi_Advanced_Transform_Nested',
            new Map<String, Object>{ 'inputParents' => parents }
        );
        interview.start();
        return (List<SfPiFlowNestedParent>) interview.getVariableValue('outputParents');
    }

    private static SfPi_Flow_Probe__c runTransformAggregate(
        List<SfPi_Flow_Probe__c> records
    ) {
        Flow.Interview interview = Flow.Interview.createInterview(
            'SfPi_Advanced_Transform_Aggregate',
            new Map<String, Object>{ 'inputRecords' => records }
        );
        interview.start();
        return (SfPi_Flow_Probe__c) interview.getVariableValue('outputRecord');
    }

    private static List<SfPi_Flow_Probe__c> upsertFailureFixture(String key) {
        return new List<SfPi_Flow_Probe__c>{
            new SfPi_Flow_Probe__c(
                Name = 'Valid Collection Member',
                CorrelationKey__c = key,
                ExternalKey__c = key + '-VALID',
                Reject__c = false
            ),
            new SfPi_Flow_Probe__c(
                Name = 'Invalid Collection Member',
                CorrelationKey__c = key,
                ExternalKey__c = key + '-INVALID',
                Reject__c = true
            )
        };
    }

    private static Flow.Interview runCollectionUpsert(
        String mode,
        List<SfPi_Flow_Probe__c> records
    ) {
        Flow.Interview interview = Flow.Interview.createInterview(
            'SfPi_Advanced_Upsert_Collection',
            new Map<String, Object>{ 'mode' => mode, 'inputRecords' => records }
        );
        interview.start();
        return interview;
    }

    private static Flow.Interview runUpsert(SfPi_Flow_Probe__c record) {
        Flow.Interview interview = Flow.Interview.createInterview(
            'SfPi_Advanced_Create_Upsert',
            new Map<String, Object>{ 'inputRecord' => record }
        );
        interview.start();
        return interview;
    }

    private static Flow.Interview runRecordOperation(
        String operation,
        List<SfPi_Flow_Probe__c> records
    ) {
        Flow.Interview interview = Flow.Interview.createInterview(
            'SfPi_Advanced_Record_Variables',
            new Map<String, Object>{ 'operation' => operation, 'inputRecords' => records }
        );
        interview.start();
        return interview;
    }

    private static List<String> sortedNames(Boolean nullsFirst) {
        List<SfPi_Flow_Probe__c> records = new List<SfPi_Flow_Probe__c>{
            new SfPi_Flow_Probe__c(Name = 'Zulu', NullableText__c = 'zulu', Sequence__c = 2),
            new SfPi_Flow_Probe__c(Name = 'Alpha Low', NullableText__c = 'alpha', Sequence__c = 1),
            new SfPi_Flow_Probe__c(Name = 'Alpha High B', NullableText__c = 'alpha', Sequence__c = 3),
            new SfPi_Flow_Probe__c(Name = 'Null Low', NullableText__c = null, Sequence__c = 1),
            new SfPi_Flow_Probe__c(Name = 'Blank High', NullableText__c = '', Sequence__c = 3),
            new SfPi_Flow_Probe__c(Name = 'Alpha High A', NullableText__c = 'alpha', Sequence__c = 3)
        };
        Flow.Interview interview = Flow.Interview.createInterview(
            'SfPi_Advanced_Multi_Sort',
            new Map<String, Object>{ 'nullsFirst' => nullsFirst, 'inputRecords' => records }
        );

        interview.start();

        List<SfPi_Flow_Probe__c> output =
            (List<SfPi_Flow_Probe__c>) interview.getVariableValue('outputRecords');
        List<String> names = new List<String>();
        for (SfPi_Flow_Probe__c record : output) {
            names.add(record.Name);
        }
        return names;
    }
}
