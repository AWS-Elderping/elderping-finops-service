// server.js
// FinOps cost explorer and analytics microservice

const express = require('express');
const cors = require('cors');
const finopsRoutes = require('./routes/finopsRoutes');
const FinOpsModel = require('./models/finopsModel');

const app = express();
app.use(cors());
app.use(express.json());

// Liveness probe (must be before path-rewrite middleware)
app.get('/health', (req, res) => res.status(200).json({ status: 'ok', service: 'finops-service' }));
app.get('/healthz', (req, res) => res.status(200).json({ status: 'ok', service: 'finops-service' }));
app.get('/ready', (req, res) => res.status(200).json({ status: 'ok', service: 'finops-service' }));

// K8s ALB path prefix compatibility: strip /api/finops prefix
app.use((req, _res, next) => {
  if (req.url.startsWith('/api/finops')) {
    req.url = req.url.replace('/api/finops', '') || '/';
  }
  next();
});

// Mount modular routes under /finops
app.use('/finops', finopsRoutes);

const PORT = process.env.PORT || 3000;

async function start() {
  const pool = FinOpsModel.getPool();
  let retries = 10;
  while (retries--) {
    try {
      await pool.query('SELECT 1');
      console.log('✅ Connected to FinOps database successfully.');
      break;
    } catch (err) {
      console.log(`⏳ Waiting for database… (${retries} retries left) error: ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  app.listen(PORT, () => {
    console.log(`FinOps service running on port ${PORT}`);
  });
}

start();
