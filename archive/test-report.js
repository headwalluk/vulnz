/**
 * Test script to generate a sample vulnerability report
 * Run with: node test-report.js
 */

require('dotenv').config();
const reporting = require('../src/lib/reporting');
const user = require('../src/models/user');

async function testReport() {
  console.log('Fetching test user...');

  // Get a user (using first user from weekly report)
  const users = await user.findUsersForWeeklyReport('MON', 1);

  if (users.length === 0) {
    console.error('No users found in database for weekly reports');
    process.exit(1);
  }

  const testUser = users[0];
  console.log(`Generating report for user: ${testUser.username} (ID: ${testUser.id})`);

  try {
    await reporting.sendSummaryEmail(testUser);
    console.log('✓ Report generated and sent successfully!');
    console.log(`  Email sent to: ${testUser.reporting_email || testUser.username}`);
  } catch (error) {
    console.error('✗ Error generating report:', error);
    process.exit(1);
  }

  process.exit(0);
}

testReport();
