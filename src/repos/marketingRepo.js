// Standalone marketing spend log — platform, date, amount, and optional
// reach/engagement/notes. Deliberately has no OrderID/ItemID column: this is
// spend tracking, not campaign attribution or ROI.

const sheets = require('../google/sheetsClient');
const { newCampaignId } = require('../utils/ids');

const SHEET = 'Marketing';

async function listAll() {
  return sheets.getRowsAsObjects(SHEET);
}

async function addMarketingRecord({ platform, postDate, amountSpend, reach, engagement, notes, createdBy }) {
  const campaignId = newCampaignId();
  await sheets.appendRow(SHEET, {
    CampaignID: campaignId,
    Timestamp: new Date().toISOString(),
    Platform: platform,
    PostDate: postDate,
    AmountSpend: amountSpend,
    Reach: reach || '',
    Engagement: engagement || '',
    Notes: notes || '',
    CreatedBy: createdBy,
  });
  return campaignId;
}

module.exports = { listAll, addMarketingRecord };
