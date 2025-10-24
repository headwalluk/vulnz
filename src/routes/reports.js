const express = require('express');
const router = express.Router();
const user = require('../models/user');
const website = require('../models/website');
const websiteComponent = require('../models/websiteComponent');
const emailer = require('../lib/email');
const { isAuthenticated } = require('../middleware/auth');
const { validateEmailAddress } = require('../lib/emailValidation');

router.post('/summary-email', isAuthenticated, async (req, res) => {
  try {
    const userId = (req.body && req.body.user_id) || (req.user && req.user.id);
    if (!userId) {
      return res.status(400).send('user_id is required');
    }

    const userToSend = await user.findUserById(userId);
    if (!userToSend) {
      return res.status(404).send('User not found');
    }

    const totalWebsites = await website.countAll(userId);
    const vulnerableWebsites = await website.findAll(userId, 1000, 0, null, true);

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
        domain: site.domain,
        vulnerableComponents: site.vulnerableComponents,
      })),
    };

    let targetEmail = userToSend.username;
    if (userToSend.reporting_email) {
      const validation = validateEmailAddress(userToSend.reporting_email);
      if (validation.isValid) {
        targetEmail = userToSend.reporting_email;
      }
    }

    await emailer.sendVulnerabilityReport(targetEmail, emailData);

    res.send('Report sent');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
