/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Syntax examples from the public Salesforce SOQL SELECT Examples and Alias
 * Notation reference pages, normalized only for straight quote characters.
 *
 * https://developer.salesforce.com/docs/platform/salesforce-soql-sosl/guide/sforce-api-calls-soql-select-examples.html
 * https://developer.salesforce.com/docs/platform/salesforce-soql-sosl/guide/sforce-api-calls-soql-alias.html
 */

export const OFFICIAL_SELECT_EXAMPLES = [
  "SELECT Id, Name, BillingCity FROM Account",
  "SELECT Id FROM Contact WHERE Name LIKE 'A%' AND MailingCity = 'California'",
  "SELECT Name FROM Account ORDER BY Name DESC NULLS LAST",
  "SELECT Name FROM Account WHERE Industry = 'media' LIMIT 125",
  "SELECT Name FROM Account WHERE Industry = 'media' ORDER BY BillingPostalCode ASC NULLS LAST LIMIT 125",
  "SELECT COUNT() FROM Contact",
  "SELECT LeadSource, COUNT(Name) FROM Lead GROUP BY LeadSource",
  "SELECT Name, COUNT(Id) FROM Account GROUP BY Name HAVING COUNT(Id) > 1",
  "SELECT Name, Id FROM Merchandise__c ORDER BY Name OFFSET 100",
  "SELECT Name, Id FROM Merchandise__c ORDER BY Name LIMIT 20 OFFSET 100",
  "SELECT Contact.FirstName, Contact.Account.Name FROM Contact",
  "SELECT Name, (SELECT LastName FROM Contacts) FROM Account",
  "SELECT Name, (SELECT LastName FROM Contacts WHERE CreatedBy.Alias = 'x') FROM Account WHERE Industry = 'media'",
  "SELECT Id, FirstName__c, Mother_of_Child__r.FirstName__c FROM Daughter__c WHERE Mother_of_Child__r.LastName__c LIKE 'C%'",
  "SELECT Name, (SELECT Name FROM Line_Items__r) FROM Merchandise__c WHERE Name LIKE 'Acme%'",
  "SELECT Id, Owner.Name FROM Task WHERE Owner.FirstName LIKE 'B%'",
  "SELECT TYPEOF What WHEN Account THEN Phone, NumberOfEmployees WHEN Opportunity THEN Amount, CloseDate ELSE Name, Email END FROM Event",
  "SELECT Name, (SELECT CreatedBy.Name FROM Notes) FROM Account",
  "SELECT UserId, LoginTime FROM LoginHistory",
  "SELECT UserId, COUNT(Id) FROM LoginHistory WHERE LoginTime > 2010-09-20T22:16:30.000Z AND LoginTime < 2010-09-21T22:16:30.000Z GROUP BY UserId",
  "SELECT Id, Name, IsActive, SobjectType, DeveloperName, Description FROM RecordType",
  "SELECT Id, Name, Account.Name FROM Contact WHERE Account.Industry = 'media'",
  "SELECT Account.Name, (SELECT Contact.LastName FROM Account.Contacts) FROM Account",
  "SELECT Id, Who.FirstName, Who.LastName FROM Task WHERE Owner.FirstName LIKE 'B%'",
  "SELECT Id, What.Name FROM Event",
  "SELECT Amount, Id, Name, (SELECT Quantity, ListPrice, PricebookEntry.UnitPrice, PricebookEntry.Name FROM OpportunityLineItems) FROM Opportunity",
  "SELECT COUNT() FROM Contact c, c.Account a WHERE a.Name = 'MyriadPubs'",
] as const;
