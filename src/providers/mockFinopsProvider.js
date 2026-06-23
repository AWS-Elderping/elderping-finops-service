// mockFinopsProvider.js
// Mock implementation of FinOps provider

const FinOpsProviderInterface = require('./finopsProviderInterface');

class MockFinOpsProvider extends FinOpsProviderInterface {
  async getCosts() {
    return {
      billingPeriod: 'Current Month (Mock)',
      eks_cost: 142.50,
      rds_cost: 84.20,
      bedrock_cost: 28.10,
      cloudwatch_cost: 12.45,
      sns_cost: 4.80,
      ses_cost: 1.20,
      other_cost: 0.00,
      total_cost: 273.25
    };
  }

  async getBudgets() {
    return [
      {
        budgetName: 'Monthly-EKS-Budget (Mock)',
        budgetLimit: 500.00,
        currentSpend: 142.50,
        unit: 'USD',
        timeUnit: 'MONTHLY'
      },
      {
        budgetName: 'Monthly-Total-Budget (Mock)',
        budgetLimit: 1000.00,
        currentSpend: 273.25,
        unit: 'USD',
        timeUnit: 'MONTHLY'
      }
    ];
  }

  async getRecommendations(costMetricsString) {
    return [
      {
        title: 'Optimize EKS Instance Types',
        description: 'Upgrade EKS nodes to modern Graviton3 instances for up to 40% better cost-performance.',
        severity: 'MEDIUM',
        status: 'OPEN',
        recommendation_date: new Date().toISOString().split('T')[0],
        category: 'EKS',
        finding: 'Over-provisioned compute nodes in development environments.',
        action_item: 'Migrate NodeGroups to t4g.medium instance type.',
        potential_savings: 45.00
      },
      {
        title: 'Idle RDS DB Instance Retention',
        description: 'Disable dev-db database running 24/7 or switch to Aurora Serverless.',
        severity: 'HIGH',
        status: 'OPEN',
        recommendation_date: new Date().toISOString().split('T')[0],
        category: 'RDS',
        finding: 'Development database has zero connections for the last 14 days.',
        action_item: 'Take snapshot and terminate instance, or implement automatic nightly shutdown.',
        potential_savings: 84.20
      }
    ];
  }
}

module.exports = MockFinOpsProvider;
