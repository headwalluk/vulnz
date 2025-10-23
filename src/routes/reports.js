const express = require('express');
const router = express.Router();
const user = require('../models/user');
const website = require('../models/website');
const websiteComponent = require('../models/websiteComponent');
const emailer = require('../lib/email');
const { apiKeyOrSessionAdminAuth } = require('../middleware/auth');

router.post('/email', apiKeyOrSessionAdminAuth, async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) {
      return res.status(400).send('user_id is required');
    }

    const userToSend = await user.findUserById(user_id);
    if (!userToSend) {
      return res.status(404).send('User not found');
    }

    const totalWebsites = await website.countAll(user_id);
    const vulnerableWebsites = await website.findAll(user_id, 1000, 0, null, true);

    for (const site of vulnerableWebsites) {
      const wordpressPlugins = await websiteComponent.getPlugins(site.id);
      const wordpressThemes = await websiteComponent.getThemes(site.id);
      site.vulnerableComponents = [...wordpressPlugins, ...wordpressThemes].filter((c) => c.has_vulnerabilities).map((c) => c.slug);
    }

    const emailData = {
      username: userToSend.username,
      totalWebsites,
      vulnerableWebsitesCount: vulnerableWebsites.length,
      vulnerableWebsites: vulnerableWebsites.map((site) => ({
        title: site.title,
        url: site.is_ssl ? `https://${site.domain}` : `http://${site.domain}`,
        vulnerableComponents: site.vulnerableComponents,
      })),
    };

    await emailer.sendVulnerabilityReport(userToSend.username, emailData);

    res.send('Report sent');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
