// providerRegistry.js
// Factory method to retrieve initialized FinOps provider based on environment config

const MockFinOpsProvider = require('./mockFinopsProvider');
const AwsFinOpsProvider = require('./awsFinopsProvider');

const getProvider = () => {
  const providerType = (process.env.FINOPS_PROVIDER || 'mock').toLowerCase();
  
  if (providerType === 'aws') {
    console.log('🔌 FinOps Service: Initializing AWS provider');
    return new AwsFinOpsProvider();
  }
  
  console.log('🔌 FinOps Service: Initializing Mock provider');
  return new MockFinOpsProvider();
};

module.exports = { getProvider };
