/* SPDX-License-Identifier: Apache-2.0 */
/** Public Salesforce examples for operators, joins, dates, polymorphism, and modifiers. */

export interface OfficialAdvancedExample {
  query: string;
  context: "api" | "apex";
  minApiVersion?: number;
}

export const OFFICIAL_ADVANCED_EXAMPLES: OfficialAdvancedExample[] = [
  {
    query: "SELECT AccountId, FirstName, LastName FROM Contact WHERE LastName LIKE 'appl%'",
    context: "api",
  },
  {
    query: "SELECT Name FROM Account WHERE BillingState IN ('California', 'New York')",
    context: "api",
  },
  {
    query: "SELECT Name FROM Account WHERE BillingState NOT IN ('California', 'New York')",
    context: "api",
  },
  {
    query:
      "SELECT Id, Name FROM Account WHERE Id IN (SELECT AccountId FROM Opportunity WHERE StageName = 'Closed Lost')",
    context: "api",
  },
  {
    query:
      "SELECT Id FROM Task WHERE WhoId IN (SELECT Id FROM Contact WHERE MailingCity = 'Twin Falls')",
    context: "api",
  },
  {
    query:
      "SELECT Id FROM Account WHERE Id NOT IN (SELECT AccountId FROM Opportunity WHERE IsClosed = false)",
    context: "api",
  },
  {
    query:
      "SELECT Id FROM Opportunity WHERE AccountId NOT IN (SELECT AccountId FROM Contact WHERE LeadSource = 'Web')",
    context: "api",
  },
  {
    query:
      "SELECT Id, Name FROM Account WHERE Id IN (SELECT AccountId FROM Contact WHERE LastName LIKE 'apple%') AND Id IN (SELECT AccountId FROM Opportunity WHERE IsClosed = false)",
    context: "api",
  },
  { query: "SELECT LeadSource FROM Lead", context: "api" },
  { query: "SELECT LeadSource, COUNT(Name) FROM Lead GROUP BY LeadSource", context: "api" },
  { query: "SELECT LeadSource FROM Lead GROUP BY LeadSource", context: "api" },
  {
    query:
      "SELECT TYPEOF What WHEN Account THEN Phone ELSE Name END FROM Event WHERE CreatedById IN (SELECT CreatedById FROM Case)",
    context: "api",
    minApiVersion: 46,
  },
  {
    query:
      "SELECT TYPEOF What WHEN Account THEN Phone, NumberOfEmployees WHEN Opportunity THEN Amount, CloseDate ELSE Name, Email END FROM Event",
    context: "api",
    minApiVersion: 46,
  },
  {
    query: "SELECT Id FROM Account WHERE CreatedDate > 2005-10-08T01:02:03Z",
    context: "api",
  },
  { query: "SELECT Id FROM Account WHERE CreatedDate = YESTERDAY", context: "api" },
  { query: "SELECT Id FROM Account WHERE CreatedDate < TODAY", context: "api" },
  { query: "SELECT Id FROM Opportunity WHERE CloseDate = TOMORROW", context: "api" },
  { query: "SELECT Id FROM Account WHERE CreatedDate > LAST_WEEK", context: "api" },
  { query: "SELECT Id FROM Account WHERE CreatedDate < THIS_WEEK", context: "api" },
  { query: "SELECT Id FROM Opportunity WHERE CloseDate = NEXT_WEEK", context: "api" },
  { query: "SELECT Id FROM Opportunity WHERE CloseDate > LAST_MONTH", context: "api" },
  { query: "SELECT Id FROM Account WHERE CreatedDate < THIS_MONTH", context: "api" },
  { query: "SELECT Id FROM Opportunity WHERE CloseDate = NEXT_MONTH", context: "api" },
  { query: "SELECT Id FROM Account WHERE CreatedDate = LAST_90_DAYS", context: "api" },
  { query: "SELECT Id FROM Opportunity WHERE CloseDate > NEXT_90_DAYS", context: "api" },
  { query: "SELECT Id FROM Account WHERE CreatedDate = LAST_N_DAYS:365", context: "api" },
  { query: "SELECT Id FROM Opportunity WHERE CloseDate > NEXT_N_DAYS:15", context: "api" },
  { query: "SELECT Id FROM Opportunity WHERE CloseDate = N_DAYS_AGO:25", context: "api" },
  { query: "SELECT Id FROM Opportunity WHERE CloseDate > NEXT_N_WEEKS:4", context: "api" },
  { query: "SELECT Id FROM Account WHERE CreatedDate = LAST_N_WEEKS:52", context: "api" },
  { query: "SELECT Id FROM Opportunity WHERE CloseDate = N_WEEKS_AGO:3", context: "api" },
  { query: "SELECT Id FROM Opportunity WHERE CloseDate > NEXT_N_MONTHS:2", context: "api" },
  { query: "SELECT Id FROM Account WHERE CreatedDate = LAST_N_MONTHS:12", context: "api" },
  { query: "SELECT Id FROM Account LIMIT 1 FOR VIEW", context: "api" },
  { query: "SELECT Id FROM Account LIMIT 1 FOR REFERENCE", context: "api" },
  { query: "SELECT Id FROM Account LIMIT 2 FOR UPDATE", context: "apex" },
  { query: "SELECT Id FROM Account WITH SECURITY_ENFORCED LIMIT 1", context: "apex" },
  { query: "SELECT Id FROM Account WITH USER_MODE LIMIT 1", context: "apex" },
  { query: "SELECT Id FROM Account WITH SYSTEM_MODE LIMIT 1", context: "apex" },
  {
    query: "SELECT LeadSource, COUNT(Name) cnt FROM Lead GROUP BY ROLLUP(LeadSource)",
    context: "api",
  },
  {
    query:
      "SELECT Status, LeadSource, COUNT(Name) cnt FROM Lead GROUP BY ROLLUP(Status, LeadSource)",
    context: "api",
  },
  {
    query:
      "SELECT Type, BillingCountry, GROUPING(Type) grpType, GROUPING(BillingCountry) grpCty, COUNT(Id) accts FROM Account GROUP BY CUBE(Type, BillingCountry) ORDER BY GROUPING(Type), GROUPING(BillingCountry)",
    context: "api",
  },
  {
    query: "SELECT LeadSource, COUNT(Name) FROM Lead GROUP BY LeadSource HAVING COUNT(Name) > 100",
    context: "api",
  },
  {
    query: "SELECT Name, COUNT(Id) FROM Account GROUP BY Name HAVING COUNT(Id) > 1",
    context: "api",
  },
  {
    query: "SELECT Id, MSP1__c FROM CustObj__c WHERE MSP1__c = 'AAA;BBB'",
    context: "api",
  },
  {
    query: "SELECT Id, MSP1__c FROM CustObj__c WHERE MSP1__c INCLUDES ('AAA;BBB', 'CCC')",
    context: "api",
    minApiVersion: 39,
  },
  {
    query: "SELECT Id FROM Event WHERE What.Type IN ('Account', 'Opportunity')",
    context: "api",
  },
  {
    query:
      "SELECT Title FROM KnowledgeArticleVersion WHERE PublishStatus = 'online' WITH DATA CATEGORY Geography__c ABOVE usa__c",
    context: "api",
  },
  {
    query:
      "SELECT Title FROM Question WHERE LastReplyDate > 2005-10-08T01:02:03Z WITH DATA CATEGORY Geography__c AT (usa__c, uk__c)",
    context: "api",
  },
  {
    query:
      "SELECT UrlName FROM KnowledgeArticleVersion WHERE PublishStatus = 'draft' WITH DATA CATEGORY Geography__c AT usa__c AND Product__c ABOVE_OR_BELOW mobile_phones__c",
    context: "api",
  },
  {
    query:
      "SELECT Id FROM UserProfileFeed WITH UserId = '005D0000001AamR' ORDER BY CreatedDate DESC, Id DESC LIMIT 20",
    context: "api",
  },
];
