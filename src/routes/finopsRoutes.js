// finopsRoutes.js
// Express Router definitions for FinOps routes, securing them via permission scopes

const express = require('express');
const router = express.Router();
const finopsController = require('../controllers/finopsController');
const { authenticate, requirePermission } = require('../../shared/auth');
const validation = require('../validation/finopsValidation');

// Read-only FinOps operations (FINOPS_READ)
router.get('/dashboard', authenticate, requirePermission('FINOPS_READ'), finopsController.getDashboard);
router.get('/costs', authenticate, requirePermission('FINOPS_READ'), finopsController.getCosts);
router.get('/budgets', authenticate, requirePermission('FINOPS_READ'), finopsController.getBudgets);
router.get('/provider-status', authenticate, requirePermission('FINOPS_READ'), finopsController.getProviderStatus);

// Privileged FinOps operations (FINOPS_MANAGE)
router.get('/recommendations', authenticate, requirePermission('FINOPS_MANAGE'), finopsController.getRecommendations);
router.post('/recommendations/:id/apply', authenticate, requirePermission('FINOPS_MANAGE'), finopsController.applyRecommendation);
router.post('/recommendations/:id/dismiss', authenticate, requirePermission('FINOPS_MANAGE'), finopsController.dismissRecommendation);

// Legacy record telemetry cost (FINOPS_MANAGE)
router.post('/costs', authenticate, requirePermission('FINOPS_MANAGE'), validation.validateCostsPayload, finopsController.recordCosts);

module.exports = router;
