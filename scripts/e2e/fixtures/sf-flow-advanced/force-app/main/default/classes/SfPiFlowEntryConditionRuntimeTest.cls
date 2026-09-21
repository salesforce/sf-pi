@IsTest
private class SfPiFlowEntryConditionRuntimeTest {
    private static final Date CONDITION_DATE = Date.newInstance(2027, 1, 15);

    private static Opportunity andCandidate(String name) {
        return new Opportunity(
            Name = name,
            Description = 'allowed',
            NextStep = 'Review',
            Amount = 1500,
            CloseDate = CONDITION_DATE,
            StageName = 'Prospecting',
            IsPrivate = false
        );
    }

    private static Map<Id, Opportunity> refreshed(List<Opportunity> opportunities) {
        return new Map<Id, Opportunity>([
            SELECT Description
            FROM Opportunity
            WHERE Id IN :opportunities
        ]);
    }

    @IsTest
    static void requiresEveryAndConditionAcrossFieldTypesAndOperators() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            List<Opportunity> opportunities = new List<Opportunity>{
                andCandidate('SFPI AND Complex End'),
                andCandidate('X SFPI AND Complex End'),
                andCandidate('SFPI AND Complex Finish'),
                andCandidate('SFPI AND Plain End'),
                andCandidate('SFPI AND Complex End'),
                andCandidate('SFPI AND Complex End'),
                andCandidate('SFPI AND Complex End'),
                andCandidate('SFPI AND Complex End'),
                andCandidate('SFPI AND Complex End'),
                andCandidate('SFPI AND Complex End'),
                andCandidate('SFPI AND Complex End')
            };
            opportunities[4].Description = 'blocked';
            opportunities[5].NextStep = null;
            opportunities[6].Amount = 1000;
            opportunities[7].Amount = 2001;
            opportunities[8].CloseDate = CONDITION_DATE.addDays(1);
            opportunities[9].StageName = 'Qualification';
            opportunities[10].IsPrivate = true;

            Test.startTest();
            insert opportunities;
            Test.stopTest();

            Map<Id, Opportunity> stored = refreshed(opportunities);
            Assert.areEqual('SFPI entry AND matched', stored.get(opportunities[0].Id).Description);
            for (Integer index = 1; index < opportunities.size(); index++) {
                Assert.areNotEqual(
                    'SFPI entry AND matched',
                    stored.get(opportunities[index].Id).Description,
                    'AND criteria must reject candidate index ' + index
                );
            }
        }
    }

    @IsTest
    static void appliesAndCriteriaToTwoHundredRecordsInOneTransaction() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            List<Opportunity> opportunities = new List<Opportunity>();
            for (Integer index = 0; index < 200; index++) {
                opportunities.add(andCandidate('SFPI AND Complex ' + index + ' End'));
            }

            Test.startTest();
            insert opportunities;
            Test.stopTest();

            Map<Id, Opportunity> stored = refreshed(opportunities);
            for (Opportunity opportunity : opportunities) {
                Assert.areEqual('SFPI entry AND matched', stored.get(opportunity.Id).Description);
            }
        }
    }

    @IsTest
    static void acceptsEitherOrBoundaryAndRejectsTheMiddle() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            List<Opportunity> opportunities = new List<Opportunity>{
                new Opportunity(Name = 'SFPI OR High', Amount = 9000, CloseDate = CONDITION_DATE, StageName = 'Prospecting'),
                new Opportunity(Name = 'SFPI OR Low', Amount = 99, CloseDate = CONDITION_DATE, StageName = 'Prospecting'),
                new Opportunity(Name = 'SFPI OR Middle', Amount = 500, CloseDate = CONDITION_DATE, StageName = 'Prospecting')
            };

            Test.startTest();
            insert opportunities;
            Test.stopTest();

            Map<Id, Opportunity> stored = refreshed(opportunities);
            Assert.areEqual('SFPI entry OR matched', stored.get(opportunities[0].Id).Description);
            Assert.areEqual('SFPI entry OR matched', stored.get(opportunities[1].Id).Description);
            Assert.areNotEqual('SFPI entry OR matched', stored.get(opportunities[2].Id).Description);
        }
    }

    @IsTest
    static void evaluatesNestedCustomConditionLogicAcrossBothOrBranches() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Account account = new Account(Name = 'SF Pi Custom Condition Parent');
            insert account;
            List<Opportunity> opportunities = new List<Opportunity>{
                new Opportunity(Name = 'SFPI CUSTOM Type Branch', Type = 'New Customer', CloseDate = CONDITION_DATE, StageName = 'Prospecting'),
                new Opportunity(Name = 'SFPI CUSTOM Source Branch', LeadSource = 'Web', CloseDate = CONDITION_DATE, StageName = 'Prospecting'),
                new Opportunity(Name = 'SFPI CUSTOM No Branch', CloseDate = CONDITION_DATE, StageName = 'Prospecting'),
                new Opportunity(Name = 'SFPI CUSTOM Has Account', Type = 'New Customer', AccountId = account.Id, CloseDate = CONDITION_DATE, StageName = 'Prospecting')
            };

            Test.startTest();
            insert opportunities;
            Test.stopTest();

            Map<Id, Opportunity> stored = refreshed(opportunities);
            Assert.areEqual('SFPI entry custom matched', stored.get(opportunities[0].Id).Description);
            Assert.areEqual('SFPI entry custom matched', stored.get(opportunities[1].Id).Description);
            Assert.areNotEqual('SFPI entry custom matched', stored.get(opportunities[2].Id).Description);
            Assert.areNotEqual('SFPI entry custom matched', stored.get(opportunities[3].Id).Description);
        }
    }

    @IsTest
    static void evaluatesFormulaEntryCriteria() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            List<Opportunity> opportunities = new List<Opportunity>{
                new Opportunity(Name = 'SFPI FORMULA Match', Amount = 500, CloseDate = CONDITION_DATE, StageName = 'Prospecting'),
                new Opportunity(Name = 'SFPI FORMULA Too Small', Amount = 499, CloseDate = CONDITION_DATE, StageName = 'Prospecting'),
                new Opportunity(Name = 'Other Formula Name', Amount = 500, CloseDate = CONDITION_DATE, StageName = 'Prospecting')
            };

            Test.startTest();
            insert opportunities;
            Test.stopTest();

            Map<Id, Opportunity> stored = refreshed(opportunities);
            Assert.areEqual('SFPI entry formula matched', stored.get(opportunities[0].Id).Description);
            Assert.areNotEqual('SFPI entry formula matched', stored.get(opportunities[1].Id).Description);
            Assert.areNotEqual('SFPI entry formula matched', stored.get(opportunities[2].Id).Description);
        }
    }
}
