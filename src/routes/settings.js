const express = require('express');
const router = express.Router();
const AppSetting = require('../models/appSetting');
const User = require('../models/user');
const { apiOrSessionAuth } = require('../middleware/auth');

/**
 * Middleware to check if user is an administrator
 */
const requireAdmin = async (req, res, next) => {
  const roles = await User.getRoles(req.user.id);
  if (!roles.includes('administrator')) {
    return res.status(403).json({
      success: false,
      error: 'Administrator privileges required'
    });
  }
  next();
};

/**
 * @swagger
 * /api/settings:
 *   get:
 *     summary: Get all application settings
 *     description: Retrieve all settings, optionally filtered by category or grouped. Requires authentication.
 *     tags: [Settings]
 *     security:
 *       - ApiKeyAuth: []
 *       - SessionAuth: []
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter settings by category (e.g., versions, retention, features)
 *       - in: query
 *         name: grouped
 *         schema:
 *           type: boolean
 *         description: Return settings grouped by category
 *     responses:
 *       200:
 *         description: Settings retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 settings:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       key:
 *                         type: string
 *                       value:
 *                         oneOf:
 *                           - type: string
 *                           - type: number
 *                           - type: boolean
 *                       type:
 *                         type: string
 *                         enum: [string, integer, float, boolean]
 *                       category:
 *                         type: string
 *                       description:
 *                         type: string
 *                       isSystem:
 *                         type: boolean
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Server error
 */
router.get('/', apiOrSessionAuth, async (req, res) => {
  try {
    const { category, grouped } = req.query;
    
    let settings;
    if (grouped === 'true') {
      settings = await AppSetting.getAllGrouped();
    } else if (category) {
      settings = await AppSetting.getAll(category);
    } else {
      settings = await AppSetting.getAll();
    }
    
    res.json({
      success: true,
      settings
    });
  } catch (error) {
    console.error('Error retrieving settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve settings'
    });
  }
});

/**
 * @swagger
 * /api/settings/{key}:
 *   get:
 *     summary: Get a single setting by key
 *     description: Retrieve a specific setting value with automatic type casting
 *     tags: [Settings]
 *     security:
 *       - ApiKeyAuth: []
 *       - SessionAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: Setting key (e.g., wordpress.current_version)
 *     responses:
 *       200:
 *         description: Setting retrieved successfully
 *       404:
 *         description: Setting not found
 *       401:
 *         description: Authentication required
 */
router.get('/:key', apiOrSessionAuth, async (req, res) => {
  try {
    const { key } = req.params;
    
    // Replace URL-encoded dots back to actual dots
    const settingKey = key.replace(/%2E/g, '.');
    
    const value = await AppSetting.get(settingKey);
    
    if (value === null) {
      return res.status(404).json({
        success: false,
        error: 'Setting not found'
      });
    }
    
    res.json({
      success: true,
      key: settingKey,
      value
    });
  } catch (error) {
    console.error('Error retrieving setting:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve setting'
    });
  }
});

/**
 * @swagger
 * /api/settings/{key}:
 *   put:
 *     summary: Create or update a setting (Admin only)
 *     description: Set a configuration value with type validation. Requires administrator privileges.
 *     tags: [Settings]
 *     security:
 *       - ApiKeyAuth: []
 *       - SessionAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: Setting key (dot-namespaced, lowercase)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - value
 *               - type
 *             properties:
 *               value:
 *                 oneOf:
 *                   - type: string
 *                   - type: number
 *                   - type: boolean
 *                 description: The value to store
 *               type:
 *                 type: string
 *                 enum: [string, integer, float, boolean]
 *                 description: Value type for casting
 *               description:
 *                 type: string
 *                 description: Human-readable description
 *               category:
 *                 type: string
 *                 description: Category for grouping
 *               isSystem:
 *                 type: boolean
 *                 description: Whether this is a system setting
 *     responses:
 *       200:
 *         description: Setting updated successfully
 *       400:
 *         description: Invalid value or type
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Administrator privileges required
 */
router.put('/:key', apiOrSessionAuth, requireAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    const { value, type, description, category, isSystem } = req.body;
    
    // Replace URL-encoded dots back to actual dots
    const settingKey = key.replace(/%2E/g, '.');
    
    // Validate required fields
    if (value === undefined || value === null) {
      return res.status(400).json({
        success: false,
        error: 'Value is required'
      });
    }
    
    if (!type) {
      return res.status(400).json({
        success: false,
        error: 'Type is required'
      });
    }
    
    // Validate type
    const validTypes = ['string', 'integer', 'float', 'boolean'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid type. Must be one of: ${validTypes.join(', ')}`
      });
    }
    
    await AppSetting.set(
      settingKey,
      value,
      type,
      description || null,
      category || null,
      isSystem || false
    );
    
    // Retrieve the updated value
    const updatedValue = await AppSetting.get(settingKey);
    
    res.json({
      success: true,
      key: settingKey,
      value: updatedValue,
      message: 'Setting updated successfully'
    });
  } catch (error) {
    console.error('Error updating setting:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to update setting'
    });
  }
});

/**
 * @swagger
 * /api/settings/{key}:
 *   delete:
 *     summary: Delete a setting (Admin only)
 *     description: Remove a non-system setting. System settings are protected from deletion.
 *     tags: [Settings]
 *     security:
 *       - ApiKeyAuth: []
 *       - SessionAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: Setting key to delete
 *     responses:
 *       200:
 *         description: Setting deleted successfully
 *       403:
 *         description: Cannot delete system setting or admin privileges required
 *       404:
 *         description: Setting not found
 *       401:
 *         description: Authentication required
 */
router.delete('/:key', apiOrSessionAuth, requireAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    
    // Replace URL-encoded dots back to actual dots
    const settingKey = key.replace(/%2E/g, '.');
    
    const deleted = await AppSetting.remove(settingKey);
    
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Setting not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Setting deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting setting:', error);
    
    // Check if this was a protected system setting
    if (error.message && error.message.includes('system setting')) {
      return res.status(403).json({
        success: false,
        error: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to delete setting'
    });
  }
});

module.exports = router;
