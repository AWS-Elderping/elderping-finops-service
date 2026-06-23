// finopsModel.js
// Data layer for FinOps PostgreSQL operations

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const FinOpsModel = {
  async getDailyCosts(limit = 30) {
    const result = await pool.query(
      'SELECT * FROM finops_daily_costs ORDER BY billing_date DESC LIMIT $1',
      [limit]
    );
    return result.rows;
  },

  async getCachedRecommendations(limit = 10) {
    const result = await pool.query(
      "SELECT * FROM finops_recommendations WHERE status = 'OPEN' ORDER BY recommendation_date DESC, created_at DESC LIMIT $1",
      [limit]
    );
    return result.rows;
  },

  async cacheRecommendation(data) {
    // 1. Deduplication: Check whether a recommendation with the same title and status OPEN already exists.
    const existing = await pool.query(
      "SELECT * FROM finops_recommendations WHERE title = $1 AND status = 'OPEN'",
      [data.title]
    );
    if (existing.rows.length > 0) {
      return existing.rows[0];
    }

    // Normalize and validate severity
    const allowedSeverities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    const severity = allowedSeverities.includes((data.severity || '').toUpperCase()) 
      ? data.severity.toUpperCase() 
      : 'MEDIUM';

    // 2. Insert new recommendation
    const result = await pool.query(
      `INSERT INTO finops_recommendations 
        (recommendation_date, category, finding, action_item, potential_savings, title, description, severity, status)
       VALUES 
        ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
       RETURNING *`,
      [
        data.date || new Date().toISOString().split('T')[0],
        data.category || 'General',
        data.finding || data.description || 'Recommendation',
        data.actionItem || data.title || 'Apply recommendation',
        data.potentialSavings || 0.00,
        data.title,
        data.description || data.finding,
        severity,
        data.status || 'OPEN'
      ]
    );
    return result.rows[0];
  },

  async applyRecommendation(id) {
    const result = await pool.query(
      `UPDATE finops_recommendations 
       SET status = 'APPLIED', is_applied = TRUE, applied_at = CURRENT_TIMESTAMP 
       WHERE id = $1 
       RETURNING *`,
      [id]
    );
    return result.rows[0];
  },

  async dismissRecommendation(id) {
    const result = await pool.query(
      `UPDATE finops_recommendations 
       SET status = 'DISMISSED', is_applied = TRUE, dismissed_at = CURRENT_TIMESTAMP 
       WHERE id = $1 
       RETURNING *`,
      [id]
    );
    return result.rows[0];
  },

  async insertDailyCost({ billingDate, eks, rds, bedrock, cloudwatch, sns, ses, other, total }) {
    const result = await pool.query(
      `INSERT INTO finops_daily_costs 
        (billing_date, eks_cost, rds_cost, bedrock_cost, cloudwatch_cost, sns_cost, ses_cost, other_cost, total_cost)
       VALUES 
        ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (billing_date)
       DO UPDATE SET
          eks_cost = EXCLUDED.eks_cost,
          rds_cost = EXCLUDED.rds_cost,
          bedrock_cost = EXCLUDED.bedrock_cost,
          cloudwatch_cost = EXCLUDED.cloudwatch_cost,
          sns_cost = EXCLUDED.sns_cost,
          ses_cost = EXCLUDED.ses_cost,
          other_cost = EXCLUDED.other_cost,
          total_cost = EXCLUDED.total_cost
       RETURNING *`,
      [billingDate, eks, rds, bedrock, cloudwatch, sns, ses, other, total]
    );
    return result.rows[0];
  },

  getPool() {
    return pool;
  }
};

module.exports = FinOpsModel;
