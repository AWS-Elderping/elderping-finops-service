// finopsController.js
// Controllers for handling FinOps cost checks, cache, and recommendation actions

const FinOpsModel = require('../models/finopsModel');
const { getProvider } = require('../providers/providerRegistry');
const { logAuditEvent } = require('../../shared/auth');

const provider = getProvider();

// In-Memory cache storage with 15-minute TTL
const cache = {
  costs: { data: null, expiresAt: 0 },
  budgets: { data: null, expiresAt: 0 },
  recommendations: { expiresAt: 0 },
  providerStatus: { status: 'healthy', lastSync: new Date() }
};

const TTL = 15 * 60 * 1000; // 15 minutes

const poolCountRecommendations = async () => {
  const pool = FinOpsModel.getPool();
  try {
    const res = await pool.query('SELECT COUNT(*) FROM finops_recommendations');
    return parseInt(res.rows[0].count, 10);
  } catch (err) {
    console.error('Failed to count DB recommendations:', err.message);
    return 0;
  }
};

const fetchCosts = async (req) => {
  const now = Date.now();
  if (cache.costs.data && cache.costs.expiresAt > now) {
    return cache.costs.data;
  }

  try {
    const data = await provider.getCosts();
    cache.costs.data = data;
    cache.costs.expiresAt = now + TTL;
    cache.providerStatus.status = 'healthy';
    cache.providerStatus.lastSync = new Date();
    return data;
  } catch (err) {
    console.error('⚠️ Error fetching costs from provider:', err.message);
    
    // Log failure audit event
    logAuditEvent(req, {
      actionType: 'PROVIDER_SYNC_FAILURE',
      resource: 'telemetry_costs',
      status: 'FAILURE',
      message: `Failed to fetch costs from provider: ${err.message}`
    });

    cache.providerStatus.status = 'degraded';
    if (cache.costs.data) {
      return cache.costs.data; // Serve expired cache
    }
    throw err; // No cached data exists
  }
};

const fetchBudgets = async (req) => {
  const now = Date.now();
  if (cache.budgets.data && cache.budgets.expiresAt > now) {
    return cache.budgets.data;
  }

  try {
    const data = await provider.getBudgets();
    cache.budgets.data = data;
    cache.budgets.expiresAt = now + TTL;
    cache.providerStatus.status = 'healthy';
    cache.providerStatus.lastSync = new Date();
    return data;
  } catch (err) {
    console.error('⚠️ Error fetching budgets from provider:', err.message);

    // Log failure audit event
    logAuditEvent(req, {
      actionType: 'PROVIDER_SYNC_FAILURE',
      resource: 'telemetry_budgets',
      status: 'FAILURE',
      message: `Failed to fetch budgets from provider: ${err.message}`
    });

    cache.providerStatus.status = 'degraded';
    if (cache.budgets.data) {
      return cache.budgets.data;
    }
    throw err;
  }
};

const fetchProviderRecommendations = async (req) => {
  const now = Date.now();
  if (cache.recommendations.expiresAt > now) {
    return;
  }

  try {
    const costs = await fetchCosts(req);
    const costMetricsString = JSON.stringify(costs);
    const recs = await provider.getRecommendations(costMetricsString);

    for (const rec of recs) {
      await FinOpsModel.cacheRecommendation({
        title: rec.title,
        description: rec.description || rec.finding,
        severity: rec.severity,
        status: rec.status || 'OPEN',
        date: rec.recommendation_date,
        category: rec.category,
        finding: rec.finding,
        actionItem: rec.action_item,
        potentialSavings: rec.potential_savings
      });
    }

    cache.recommendations.expiresAt = now + TTL;
    cache.providerStatus.status = 'healthy';
    cache.providerStatus.lastSync = new Date();
  } catch (err) {
    console.error('⚠️ Error syncing recommendations from provider:', err.message);

    logAuditEvent(req, {
      actionType: 'PROVIDER_SYNC_FAILURE',
      resource: 'telemetry_recommendations',
      status: 'FAILURE',
      message: `Failed to sync recommendations from provider: ${err.message}`
    });

    cache.providerStatus.status = 'degraded';

    // Propagate error only if database is completely empty (no cached data at all)
    const dbCount = await poolCountRecommendations();
    if (dbCount === 0) {
      throw err;
    }
  }
};

const getDashboard = async (req, res) => {
  try {
    const costs = await fetchCosts(req);
    const history = await FinOpsModel.getDailyCosts(30);
    const budgets = await fetchBudgets(req);
    const openRecs = await FinOpsModel.getCachedRecommendations(100);

    const recommendationSummary = {
      count: openRecs.length,
      potentialSavings: openRecs.reduce((sum, r) => sum + parseFloat(r.potential_savings || 0), 0)
    };

    // Calculate forecast based on current day of month
    const now = new Date();
    const currentDay = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const monthlyForecast = Math.round((costs.total_cost / Math.max(1, currentDay)) * daysInMonth * 100) / 100;

    // Daily Trend
    const dailyTrend = history.map(h => ({
      date: h.billing_date ? h.billing_date.toISOString().split('T')[0] : null,
      totalCost: parseFloat(h.total_cost || 0)
    }));

    // Top Cost Drivers
    const drivers = [
      { service: 'EKS', cost: costs.eks_cost || 0.00 },
      { service: 'RDS', cost: costs.rds_cost || 0.00 },
      { service: 'Bedrock', cost: costs.bedrock_cost || 0.00 },
      { service: 'CloudWatch', cost: costs.cloudwatch_cost || 0.00 },
      { service: 'SNS', cost: costs.sns_cost || 0.00 },
      { service: 'SES', cost: costs.ses_cost || 0.00 },
      { service: 'Other', cost: costs.other_cost || 0.00 }
    ];
    drivers.sort((a, b) => b.cost - a.cost);
    const topCostDrivers = drivers.filter(d => d.cost > 0);

    logAuditEvent(req, {
      actionType: 'VIEW_DASHBOARD',
      resource: 'finops_dashboard',
      status: 'SUCCESS',
      message: 'Viewed FinOps dashboard metrics'
    });

    res.json({
      totalMonthlyCost: costs.total_cost,
      monthlyForecast,
      dailyTrend,
      budgetSummary: budgets,
      recommendationSummary,
      topCostDrivers,
      generatedAt: now.toISOString()
    });
  } catch (error) {
    res.status(503).json({ error: `FinOps Dashboard Telemetry Unavailable: ${error.message}` });
  }
};

const getCosts = async (req, res) => {
  try {
    const costs = await fetchCosts(req);

    logAuditEvent(req, {
      actionType: 'VIEW_COSTS',
      resource: 'finops_costs',
      status: 'SUCCESS',
      message: 'Viewed FinOps cost telemetry'
    });

    res.json(costs);
  } catch (error) {
    res.status(503).json({ error: `FinOps Cost Telemetry Unavailable: ${error.message}` });
  }
};

const getBudgets = async (req, res) => {
  try {
    const budgets = await fetchBudgets(req);

    logAuditEvent(req, {
      actionType: 'VIEW_BUDGETS',
      resource: 'finops_budgets',
      status: 'SUCCESS',
      message: 'Viewed FinOps active budgets'
    });

    res.json(budgets);
  } catch (error) {
    res.status(503).json({ error: `FinOps Active Budgets Unavailable: ${error.message}` });
  }
};

const getRecommendations = async (req, res) => {
  try {
    await fetchProviderRecommendations(req);
    const currentRecs = await FinOpsModel.getCachedRecommendations(50);

    logAuditEvent(req, {
      actionType: 'VIEW_RECOMMENDATIONS',
      resource: 'finops_recommendations',
      status: 'SUCCESS',
      message: 'Viewed FinOps cost optimization recommendations'
    });

    res.json(currentRecs);
  } catch (error) {
    res.status(503).json({ error: `FinOps Recommendations Unavailable: ${error.message}` });
  }
};

const applyRecommendation = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await FinOpsModel.applyRecommendation(id);
    if (!result) return res.status(404).json({ error: 'Recommendation not found' });

    logAuditEvent(req, {
      actionType: 'APPLY_RECOMMENDATION',
      resource: 'finops_recommendations',
      resourceId: id,
      status: 'SUCCESS',
      message: `FinOps recommendation applied: ${id}`
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const dismissRecommendation = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await FinOpsModel.dismissRecommendation(id);
    if (!result) return res.status(404).json({ error: 'Recommendation not found' });

    logAuditEvent(req, {
      actionType: 'DISMISS_RECOMMENDATION',
      resource: 'finops_recommendations',
      resourceId: id,
      status: 'SUCCESS',
      message: `FinOps recommendation dismissed: ${id}`
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getProviderStatus = async (req, res) => {
  try {
    const providerType = (process.env.FINOPS_PROVIDER || 'mock').toLowerCase();
    const cacheAvailable = !!(cache.costs.data || cache.budgets.data || (await poolCountRecommendations() > 0));

    res.json({
      provider: providerType === 'aws' ? 'aws' : 'mock',
      status: cache.providerStatus.status,
      cacheAvailable,
      lastSuccessfulSync: cache.providerStatus.lastSync.toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const recordCosts = async (req, res) => {
  try {
    const { billingDate, eks, rds, bedrock, cloudwatch, sns, ses, other, total } = req.body;
    const result = await FinOpsModel.insertDailyCost({
      billingDate,
      eks: eks || 0.0,
      rds: rds || 0.0,
      bedrock: bedrock || 0.0,
      cloudwatch: cloudwatch || 0.0,
      sns: sns || 0.0,
      ses: ses || 0.0,
      other: other || 0.0,
      total
    });

    logAuditEvent(req, {
      actionType: 'RECORD_FINOPS_DAILY_COST',
      resource: 'finops_daily_costs',
      resourceId: result.id,
      status: 'SUCCESS',
      message: `Recorded daily cost metric for date: ${billingDate}`
    });

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getDashboard,
  getCosts,
  getBudgets,
  getRecommendations,
  applyRecommendation,
  dismissRecommendation,
  getProviderStatus,
  recordCosts
};
