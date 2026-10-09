/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Valid syntax examples from the public Salesforce aggregate, date, formatting,
 * grouping, timezone, and label function reference pages.
 */

export const OFFICIAL_FUNCTION_EXAMPLES = [
  "SELECT AVG(Amount) FROM Opportunity",
  "SELECT CampaignId, AVG(Amount) FROM Opportunity GROUP BY CampaignId",
  "SELECT COUNT() FROM Account WHERE Name LIKE 'a%'",
  "SELECT COUNT(Id) FROM Account WHERE Name LIKE 'a%'",
  "SELECT COUNT_DISTINCT(Company) FROM Lead",
  "SELECT MIN(CreatedDate), FirstName, LastName FROM Contact GROUP BY FirstName, LastName",
  "SELECT Name, MAX(BudgetedCost) FROM Campaign GROUP BY Name",
  "SELECT SUM(Amount) FROM Opportunity WHERE IsClosed = false AND Probability > 60",
  "SELECT HOUR_IN_DAY(convertTimezone(CreatedDate)), SUM(Amount) FROM Opportunity GROUP BY HOUR_IN_DAY(convertTimezone(CreatedDate))",
  "SELECT CALENDAR_YEAR(CreatedDate), SUM(Amount) FROM Opportunity GROUP BY CALENDAR_YEAR(CreatedDate)",
  "SELECT CreatedDate, Amount FROM Opportunity WHERE CALENDAR_YEAR(CreatedDate) = 2009",
  "SELECT CALENDAR_YEAR(CloseDate) FROM Opportunity GROUP BY CALENDAR_YEAR(CloseDate)",
  "SELECT LastModifiedDate FROM Opportunity",
  "SELECT FORMAT(LastModifiedDate) FROM Opportunity",
  "SELECT FORMAT(Amount) FROM Opportunity",
  "SELECT Id, LastModifiedDate, FORMAT(LastModifiedDate) formattedDate FROM Account",
  "SELECT Amount, FORMAT(Amount) Amt, convertCurrency(Amount) editDate, FORMAT(convertCurrency(Amount)) convertedCurrency FROM Opportunity WHERE Id = '006000000000001AAA'",
  "SELECT FORMAT(MIN(CloseDate)) Amt FROM Opportunity",
  "SELECT LeadSource, Rating, GROUPING(LeadSource) grpLS, GROUPING(Rating) grpRating, COUNT(Name) cnt FROM Lead GROUP BY ROLLUP(LeadSource, Rating)",
  "SELECT Company, toLabel(Recordtype.Name) FROM Lead",
  "SELECT Company, Status, toLabel(Status) translatedStatus FROM Lead",
  "SELECT Company, toLabel(Status) FROM Lead WHERE toLabel(Status) = 'le Draft'",
] as const;
