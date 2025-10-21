const express = require('express');
const router = express.Router();
const Website = require('../models/website');
const User = require('../models/user');
const { apiOrSessionAuth } = require('../middleware/auth');
const Component = require('../models/component');
const Release = require('../models/release');
const WebsiteComponent = require('../models/websiteComponent');

const getWebsiteComponents = async (website) => {
    const wordpressPlugins = await WebsiteComponent.getPlugins(website.id);
    const wordpressThemes = await WebsiteComponent.getThemes(website.id);
    return { wordpressPlugins, wordpressThemes };
}

const canAccessWebsite = async (req, res, next) => {
    const { domain } = req.params;
    const website = await Website.findByDomain(domain);

    if (!website) {
        return res.status(404).send('Website not found');
    }

    const roles = await User.getRoles(req.user.id);
    if (website.user_id !== req.user.id && !roles.includes('administrator')) {
        return res.status(401).send('Unauthorized');
    }

    req.website = website;
    next();
}

const addVulnerabilityCount = (website) => {
    const vulnerablePlugins = (website['wordpress-plugins'] || []).filter(p => p.has_vulnerabilities).length;
    const vulnerableThemes = (website['wordpress-themes'] || []).filter(t => t.has_vulnerabilities).length;
    website.vulnerability_count = vulnerablePlugins + vulnerableThemes;
};

const addUrl = (website) => {
    website.url = `${website.is_ssl ? 'https' : 'http'}://${website.domain}`;
};

router.get('/', apiOrSessionAuth, async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;
        const offset = (page - 1) * limit;

        const total = await Website.countAll(req.user.id);
        const websites = await Website.findAll(req.user.id, limit, offset);

        for (const website of websites) {
            const { wordpressPlugins, wordpressThemes } = await getWebsiteComponents(website);
            website['wordpress-plugins'] = wordpressPlugins;
            website['wordpress-themes'] = wordpressThemes;
            addVulnerabilityCount(website);
            addUrl(website);
        }

        res.json({
            websites: websites || [],
            total,
            page,
            limit,
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

router.get('/:domain', apiOrSessionAuth, canAccessWebsite, async (req, res) => {
    try {
        const { wordpressPlugins, wordpressThemes } = await getWebsiteComponents(req.website);
        req.website['wordpress-plugins'] = wordpressPlugins;
        req.website['wordpress-themes'] = wordpressThemes;
        addVulnerabilityCount(req.website);
        addUrl(req.website);
        res.json(req.website);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

router.post('/', apiOrSessionAuth, async (req, res) => {
    try {
        const { domain, title, user_id } = req.body;
        const roles = await User.getRoles(req.user.id);
        let websiteUserId = req.user.id;

        if (roles.includes('administrator') && user_id) {
            websiteUserId = user_id;
        }

        const website = await Website.create({ user_id: websiteUserId, domain, title });

        if (roles.includes('administrator')) {
            res.status(201).json({
                ...website,
                id: parseInt(website.id, 10),
                user_id: parseInt(website.user_id, 10),
            });
        } else {
            const { id, user_id, ...responseWebsite } = website;
            res.status(201).json(responseWebsite);
        }
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).send('That website has already been added.');
        }
        console.error(err);
        res.status(500).send('Server error');
    }
});

const processComponents = async (components, componentType) => {
    const releaseIds = [];
    if (Array.isArray(components)) {
        for (const { slug, version } of components) {
            const component = await Component.findOrCreate(slug, componentType, slug);
            const release = await Release.findOrCreate(component.id, version);
            releaseIds.push(release.id);
        }
    }
    return releaseIds;
};

router.put('/:domain', apiOrSessionAuth, canAccessWebsite, async (req, res) => {
    try {
        const { title, 'wordpress-plugins': wordpressPlugins, 'wordpress-themes': wordpressThemes } = req.body;
        const websiteData = {};
        if (title) {
            websiteData.title = title;
        }

        if (Object.keys(websiteData).length > 0) {
            await Website.update(req.params.domain, websiteData);
        }

        if (wordpressPlugins) {
            await WebsiteComponent.deleteByType(req.website.id, 'wordpress-plugin');
            const pluginReleaseIds = await processComponents(wordpressPlugins, 'wordpress-plugin');
            for (const releaseId of pluginReleaseIds) {
                await WebsiteComponent.create(req.website.id, releaseId);
            }
        }

        if (wordpressThemes) {
            await WebsiteComponent.deleteByType(req.website.id, 'wordpress-theme');
            const themeReleaseIds = await processComponents(wordpressThemes, 'wordpress-theme');
            for (const releaseId of themeReleaseIds) {
                await WebsiteComponent.create(req.website.id, releaseId);
            }
        }

        res.send('Website updated');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

router.delete('/:domain', apiOrSessionAuth, canAccessWebsite, async (req, res) => {
    try {
        await Website.remove(req.params.domain);
        res.send('Website deleted');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

module.exports = router;
