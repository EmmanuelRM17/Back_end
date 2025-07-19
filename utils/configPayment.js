const db = require('../db'); // o '../../../db' según tu estructura

const getPaymentConfig = (environment = 'sandbox', callback) => {
  const query = `
    SELECT provider, setting_key, setting_value, is_encrypted
    FROM config_payment 
    WHERE environment = ? AND is_active = 1
    ORDER BY provider, setting_key
  `;

  db.query(query, [environment], (err, results) => {
    if (err) return callback(err, null);

    const config = {};

    results.forEach(row => {
      const provider = row.provider;
      const key = row.setting_key;
      const value = row.setting_value ?? '';

      if (!config[provider]) {
        config[provider] = {};
      }

      config[provider][key] = value;
    });

    callback(null, config);
  });
};

module.exports = { getPaymentConfig };
