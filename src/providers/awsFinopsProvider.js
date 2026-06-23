// awsFinopsProvider.js
// AWS Cost Explorer, Budgets, and STS client implementation of FinOps provider

const FinOpsProviderInterface = require('./finopsProviderInterface');
const { CostExplorerClient, GetCostAndUsageCommand } = require('@aws-sdk/client-cost-explorer');
const { BudgetsClient, DescribeBudgetsCommand } = require('@aws-sdk/client-budgets');
const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts');

class AwsFinOpsProvider extends FinOpsProviderInterface {
  constructor() {
    super();
    this.awsRegion = process.env.AWS_REGION || 'us-east-1';
    this.cachedAccountId = null;

    try {
      this.ceClient = new CostExplorerClient({ region: this.awsRegion });
      this.budgetsClient = new BudgetsClient({ region: this.awsRegion });
      this.stsClient = new STSClient({ region: this.awsRegion });
    } catch (err) {
      console.error('⚠️ AwsFinOpsProvider failed to initialize AWS clients:', err.message);
      this.ceClient = null;
      this.budgetsClient = null;
      this.stsClient = null;
    }
  }

  /**
   * Resolves the AWS Account ID dynamically.
   * Uses AWS_ACCOUNT_ID env if present, otherwise calls STS GetCallerIdentity.
   * Caches the resolved account ID to avoid repeated STS calls.
   */
  async getAccountId() {
    if (process.env.AWS_ACCOUNT_ID) {
      return process.env.AWS_ACCOUNT_ID;
    }
    if (this.cachedAccountId) {
      return this.cachedAccountId;
    }
    if (!this.stsClient) {
      throw new Error('AWS STSClient is not initialized.');
    }

    try {
      const command = new GetCallerIdentityCommand({});
      const response = await this.stsClient.send(command);
      this.cachedAccountId = response.Account;
      return this.cachedAccountId;
    } catch (err) {
      console.error('⚠️ Failed to resolve AWS Account ID via STS:', err.message);
      throw err;
    }
  }

  async getCosts() {
    if (!this.ceClient) {
      throw new Error('AWS CostExplorerClient is not initialized.');
    }

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const end = now.toISOString().split('T')[0];

    const command = new GetCostAndUsageCommand({
      TimePeriod: { Start: start, End: end },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }]
    });

    const data = await this.ceClient.send(command);
    
    // Parse AWS Cost Explorer response to map back to our dashboard categories
    const results = {
      billingPeriod: `${start} to ${end}`,
      eks_cost: 0.00,
      rds_cost: 0.00,
      bedrock_cost: 0.00,
      cloudwatch_cost: 0.00,
      sns_cost: 0.00,
      ses_cost: 0.00,
      other_cost: 0.00,
      total_cost: 0.00
    };

    if (data.ResultsByTime && data.ResultsByTime.length > 0) {
      const groups = data.ResultsByTime[0].Groups || [];
      for (const group of groups) {
        const serviceName = (group.Keys && group.Keys[0]) || '';
        const amount = parseFloat(group.Metrics.UnblendedCost.Amount || '0.00');

        results.total_cost += amount;

        if (serviceName.includes('Amazon Elastic Kubernetes Service') || serviceName.includes('EKS')) {
          results.eks_cost += amount;
        } else if (serviceName.includes('Amazon Relational Database Service') || serviceName.includes('RDS')) {
          results.rds_cost += amount;
        } else if (serviceName.includes('Amazon Bedrock') || serviceName.includes('Bedrock')) {
          results.bedrock_cost += amount;
        } else if (serviceName.includes('Amazon CloudWatch') || serviceName.includes('CloudWatch')) {
          results.cloudwatch_cost += amount;
        } else if (serviceName.includes('Amazon Simple Notification Service') || serviceName.includes('SNS')) {
          results.sns_cost += amount;
        } else if (serviceName.includes('Amazon Simple Email Service') || serviceName.includes('SES')) {
          results.ses_cost += amount;
        } else {
          results.other_cost += amount;
        }
      }
    }

    // Round values to 2 decimal places
    for (const key of Object.keys(results)) {
      if (typeof results[key] === 'number') {
        results[key] = Math.round(results[key] * 100) / 100;
      }
    }

    return results;
  }

  async getBudgets() {
    if (!this.budgetsClient) {
      throw new Error('AWS BudgetsClient is not initialized.');
    }

    const accountId = await this.getAccountId();
    const command = new DescribeBudgetsCommand({ AccountId: accountId });
    const data = await this.budgetsClient.send(command);

    const budgets = (data.Budgets || []).map(b => {
      const limit = parseFloat(b.BudgetLimit?.Amount || '0.00');
      const spend = parseFloat(b.CalculatedSpend?.ActualSpend?.Amount || '0.00');
      return {
        budgetName: b.BudgetName,
        budgetLimit: Math.round(limit * 100) / 100,
        currentSpend: Math.round(spend * 100) / 100,
        unit: b.BudgetLimit?.Unit || 'USD',
        timeUnit: b.TimeUnit || 'MONTHLY'
      };
    });

    return budgets;
  }

  async getRecommendations(costMetricsString) {
    const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://ai-service:3000';
    const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
    
    let recommendationText = 'Consolidate workloads and enable scaling limits.';
    try {
      const response = await fetch(`${aiServiceUrl}/ai/finops-recs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ costMetricsString })
      });
      if (response.ok) {
        const aiData = await response.json();
        recommendationText = aiData.recommendation;
      }
    } catch (err) {
      console.warn('⚠️ Failed to fetch AI recommendations from provider, using fallback:', err.message);
    }

    return [
      {
        title: 'Optimize EKS Instance Types',
        description: recommendationText,
        severity: 'MEDIUM',
        status: 'OPEN',
        recommendation_date: new Date().toISOString().split('T')[0],
        category: 'EKS',
        finding: 'Aggregated resource utilization checks',
        action_item: recommendationText,
        potential_savings: 45.00
      }
    ];
  }
}

module.exports = AwsFinOpsProvider;
