// finopsValidation.js
// Validation rules for FinOps service inputs

const validateCostsPayload = (req, res, next) => {
  const { billingDate, total } = req.body;
  
  if (!billingDate || typeof billingDate !== 'string') {
    return res.status(400).json({ error: 'billingDate is required and must be a ISO date string YYYY-MM-DD' });
  }
  
  if (total === undefined || typeof total !== 'number') {
    return res.status(400).json({ error: 'total is required and must be a number' });
  }

  next();
};

module.exports = {
  validateCostsPayload
};
