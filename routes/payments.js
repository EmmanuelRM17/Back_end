// routes/admin/inf/payments.js - Rutas de Pagos con configuración dinámica
const express = require('express');
const router = express.Router();
const db = require('../db');
const axios = require('axios');
const { getPaymentConfig } = require('../utils/configPayment');

// ==================== FUNCIONES AUXILIARES ====================

// Función para manejar errores (igual que en finanzas.js)
const handleQueryError = (err, res, mensaje) => {
  console.error(`Error: ${mensaje}`, err);
  return res.status(500).json({ error: "Error interno del servidor" });
};

// Función para obtener configuración específica de config_payment
const getPaymentSetting = (provider, settingKey, environment = 'sandbox', callback) => {
  const query = `
    SELECT setting_value 
    FROM config_payment 
    WHERE provider = ? AND setting_key = ? AND environment = ? AND is_active = 1
  `;
  
  db.query(query, [provider, settingKey, environment], (err, result) => {
    if (err) return callback(err, null);
    
    if (result.length === 0) {
      return callback(null, null);
    }
    
    callback(null, result[0].setting_value);
  });
};

// Función para obtener configuración completa de MercadoPago
const getMercadoPagoConfig = (environment = 'sandbox', callback) => {
  getPaymentConfig(environment, (err, config) => {
    if (err) return callback(err, null);

    const mp = config.mercadopago || {};
    callback(null, {
      accessToken: mp.access_token || '',
      publicKey: mp.public_key || '',
      enabled: mp.enabled === 'true',
      environment
    });
  });
};

// Función para obtener configuración completa de PayPal
const getPayPalConfig = (environment = 'sandbox', callback) => {
  getPaymentConfig(environment, (err, config) => {
    if (err) return callback(err, null);

    const pp = config.paypal || {};
    const baseUrl = environment === 'production'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';

    callback(null, {
      clientId: pp.client_id || '',
      clientSecret: pp.client_secret || '',
      enabled: pp.enabled === 'true',
      environment,
      baseUrl
    });
  });
};


// Función para convertir MXN a USD
const convertMXNToUSD = (amountMXN) => {
  const exchangeRate = 18.50;
  return (parseFloat(amountMXN) / exchangeRate).toFixed(2);
};

// Función para guardar pago aprobado en base de datos
const procesarPagoAprobado = (paymentData, callback) => {
  try {
    console.log('✅ Procesando pago aprobado:', paymentData);
    
    const query = `
      INSERT INTO pagos (
        paciente_id, cita_id, monto, subtotal, total, concepto,
        metodo_pago, fecha_pago, estado, comprobante, notas, fecha_creacion
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), 'Pagado', ?, ?, NOW())
    `;
    
    const values = [
      paymentData.patient_id,
      paymentData.service_id,
      paymentData.original_amount_mxn || paymentData.amount,
      paymentData.original_amount_mxn || paymentData.amount,
      paymentData.original_amount_mxn || paymentData.amount,
      `Pago procesado via ${paymentData.platform}`,
      paymentData.platform === 'mercadopago' ? 'MercadoPago' : 'PayPal',
      paymentData.payment_id,
      `Pago automático desde ${paymentData.platform}. Estado: ${paymentData.status}`
    ];
    
    db.query(query, values, (err, result) => {
      if (err) {
        console.error('❌ Error guardando pago aprobado:', err);
        return callback(err);
      }
      
      console.log('✅ Pago guardado exitosamente:', result.insertId);
      
      // Actualizar estado de la cita si existe
      if (paymentData.service_id) {
        const updateCitaQuery = `UPDATE citas SET estado_pago = 'Pagado' WHERE id = ?`;
        db.query(updateCitaQuery, [paymentData.service_id], (updateErr) => {
          if (updateErr) {
            console.error('Error actualizando cita:', updateErr);
          } else {
            console.log('✅ Cita actualizada tras pago automático');
          }
          callback(null, result);
        });
      } else {
        callback(null, result);
      }
    });
    
  } catch (error) {
    console.error('❌ Error procesando pago aprobado:', error);
    callback(error);
  }
};

// Función para procesar pago rechazado
const procesarPagoRechazado = (paymentData, callback) => {
  try {
    console.log('❌ Pago rechazado:', paymentData);
    
    // Aquí puedes agregar lógica para notificar al usuario o actualizar estado
    // Por ejemplo, enviar email de notificación, actualizar base de datos, etc.
    
    callback(null, 'Pago rechazado procesado');
  } catch (error) {
    console.error('❌ Error procesando pago rechazado:', error);
    callback(error);
  }
};

// GET - Obtener configuración actual
router.get('/config', (req, res) => {
  try {
    const environment = req.query.environment || 'sandbox';
    
    getPaymentConfig(environment, (err, config) => {
      if (err) return handleQueryError(err, res, "obtener configuración");
      
      // Convertir strings a booleanos donde corresponda
      const processedConfig = {};
      Object.keys(config).forEach(provider => {
        processedConfig[provider] = {};
        Object.keys(config[provider]).forEach(key => {
          const value = config[provider][key];
          if (key === 'enabled') {
            processedConfig[provider][key] = value === 'true' || value === '1';
          } else {
            processedConfig[provider][key] = value || '';
          }
        });
      });
      
      res.json({
        success: true,
        environment: environment,
        config: processedConfig
      });
    });
  } catch (error) {
    handleQueryError(error, res, "consulta de configuración");
  }
});


// PUT - Guardar configuración
router.put('/config', (req, res) => {
  try {
    const { config, environment = 'sandbox' } = req.body;
    
    if (!config) {
      return res.status(400).json({ 
        error: 'Configuración requerida' 
      });
    }
    
    // Función para guardar configuración específica (agregar si no existe)
    const savePaymentSetting = (provider, settingKey, settingValue, environment = 'sandbox', callback) => {
      const query = `
        UPDATE config_payment 
        SET setting_value = ?, updated_at = NOW() 
        WHERE provider = ? AND setting_key = ? AND environment = ?
      `;
      
      db.query(query, [settingValue, provider, settingKey, environment], (err, result) => {
        if (err) return callback(err);
        
        if (result.affectedRows === 0) {
          return callback(new Error(`Configuración no encontrada: ${provider}.${settingKey} en ${environment}`));
        }
        
        callback(null, result);
      });
    };
    
    // Contar total de operaciones para saber cuándo terminar
    let totalOperations = 0;
    let completedOperations = 0;
    let hasError = false;
    
    // Contar operaciones
    Object.keys(config).forEach(provider => {
      Object.keys(config[provider]).forEach(key => {
        totalOperations++;
      });
    });
    
    if (totalOperations === 0) {
      return res.json({ 
        success: true, 
        message: 'No hay configuraciones para guardar',
        environment: environment
      });
    }
    
    // Función para verificar si terminamos
    const checkCompletion = () => {
      completedOperations++;
      if (completedOperations === totalOperations && !hasError) {
        res.json({ 
          success: true, 
          message: 'Configuración guardada exitosamente',
          environment: environment
        });
      }
    };
    
    // Procesar configuraciones por proveedor
    Object.keys(config).forEach(provider => {
      Object.keys(config[provider]).forEach(key => {
        let value = config[provider][key];
        
        // Convertir booleanos a strings
        if (typeof value === 'boolean') {
          value = value ? 'true' : 'false';
        }
        
        savePaymentSetting(provider, key, value, environment, (err) => {
          if (err && !hasError) {
            hasError = true;
            return handleQueryError(err, res, "guardar configuración");
          }
          checkCompletion();
        });
      });
    });
    
  } catch (error) {
    handleQueryError(error, res, "procesar configuración");
  }
});

// POST - Probar conexión con MercadoPago
router.post('/test-mercadopago', (req, res) => {
  try {
    const { environment = 'sandbox' } = req.body;
    
    // Obtener credenciales de la base de datos
    getPaymentSetting('mercadopago', 'access_token', environment, (err, accessToken) => {
      if (err) return handleQueryError(err, res, "obtener token MercadoPago");
      
      if (!accessToken) {
        return res.status(400).json({ 
          error: 'Access token de MercadoPago no configurado' 
        });
      }
      
      getPaymentSetting('mercadopago', 'enabled', environment, (err, enabled) => {
        if (err) return handleQueryError(err, res, "verificar estado MercadoPago");
        
        if (enabled !== 'true') {
          return res.status(400).json({ 
            error: 'MercadoPago no está habilitado' 
          });
        }
        
        // Probar la conexión con axios
        const axios = require('axios');
        axios.get('https://api.mercadopago.com/v1/account/settings', {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        })
        .then(response => {
          if (response.status === 200) {
            res.json({
              success: true,
              message: 'Conexión exitosa con MercadoPago',
              environment: environment,
              account_info: {
                id: response.data.id || 'N/A',
                name: response.data.name || 'N/A',
                email: response.data.email || 'N/A',
                country: response.data.country || 'N/A'
              }
            });
          } else {
            throw new Error('Respuesta inesperada de MercadoPago');
          }
        })
        .catch(error => {
          console.error('Error probando MercadoPago:', error);
          
          let errorMessage = 'Error de conexión con MercadoPago';
          if (error.response) {
            if (error.response.status === 401) {
              errorMessage = 'Token de acceso inválido';
            } else {
              errorMessage = `Error ${error.response.status}: ${error.response.data?.message || 'Credenciales inválidas'}`;
            }
          } else if (error.code === 'ECONNABORTED') {
            errorMessage = 'Timeout de conexión - Verifique su conexión a internet';
          }
          
          res.status(400).json({ 
            error: errorMessage,
            details: error.message 
          });
        });
      });
    });
  } catch (error) {
    handleQueryError(error, res, "probar MercadoPago");
  }
});

// POST - Probar conexión con PayPal
router.post('/test-paypal', (req, res) => {
  try {
    const { environment = 'sandbox' } = req.body;
    
    // Obtener credenciales de la base de datos
    getPaymentSetting('paypal', 'client_id', environment, (err, clientId) => {
      if (err) return handleQueryError(err, res, "obtener client_id PayPal");
      
      getPaymentSetting('paypal', 'client_secret', environment, (err, clientSecret) => {
        if (err) return handleQueryError(err, res, "obtener client_secret PayPal");
        
        if (!clientId || !clientSecret) {
          return res.status(400).json({ 
            error: 'Credenciales de PayPal no configuradas' 
          });
        }
        
        getPaymentSetting('paypal', 'enabled', environment, (err, enabled) => {
          if (err) return handleQueryError(err, res, "verificar estado PayPal");
          
          if (enabled !== 'true') {
            return res.status(400).json({ 
              error: 'PayPal no está habilitado' 
            });
          }
          
          // Determinar URL base según el entorno
          const baseUrl = environment === 'production' 
            ? 'https://api-m.paypal.com'
            : 'https://api-m.sandbox.paypal.com';
          
          // Obtener token de acceso
          const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
          const axios = require('axios');
          
          axios.post(`${baseUrl}/v1/oauth2/token`, 
            'grant_type=client_credentials',
            {
              headers: {
                'Authorization': `Basic ${auth}`,
                'Accept': 'application/json',
                'Accept-Language': 'en_US',
                'Content-Type': 'application/x-www-form-urlencoded'
              },
              timeout: 10000
            }
          )
          .then(tokenResponse => {
            if (tokenResponse.status === 200) {
              res.json({
                success: true,
                message: 'Conexión exitosa con PayPal',
                environment: environment,
                account_info: {
                  scope: tokenResponse.data.scope,
                  token_type: tokenResponse.data.token_type,
                  expires_in: tokenResponse.data.expires_in,
                  app_id: tokenResponse.data.app_id || 'N/A'
                }
              });
            } else {
              throw new Error('No se pudo obtener token de PayPal');
            }
          })
          .catch(error => {
            console.error('Error probando PayPal:', error);
            
            let errorMessage = 'Error de conexión con PayPal';
            if (error.response) {
              if (error.response.status === 401) {
                errorMessage = 'Credenciales de PayPal inválidas';
              } else {
                errorMessage = `Error ${error.response.status}: ${error.response.data?.error_description || 'Error de autenticación'}`;
              }
            } else if (error.code === 'ECONNABORTED') {
              errorMessage = 'Timeout de conexión - Verifique su conexión a internet';
            }
            
            res.status(400).json({ 
              error: errorMessage,
              details: error.message 
            });
          });
        });
      });
    });
  } catch (error) {
    handleQueryError(error, res, "probar PayPal");
  }
});

// ==================== MERCADOPAGO ====================

// Crear preferencia de pago en MercadoPago
router.post('/mercadopago/create-preference', (req, res) => {
  try {
    const { 
      title, 
      amount, 
      email,
      reference,
      service_id,
      patient_id,
      environment = 'sandbox'
    } = req.body;

    // Validar datos requeridos
    if (!title || !amount || !email) {
      return res.status(400).json({
        error: 'Faltan datos requeridos: title, amount, email'
      });
    }

    // Obtener configuración dinámica
    getMercadoPagoConfig(environment, (err, config) => {
      if (err) return handleQueryError(err, res, "obtener configuración MercadoPago");
      
      if (!config || !config.enabled) {
        return res.status(400).json({
          error: 'MercadoPago no está configurado o habilitado'
        });
      }

      // Crear preferencia
      const preferenceData = {
        items: [
          {
            title: title,
            quantity: 1,
            unit_price: parseFloat(amount),
            currency_id: 'MXN'
          }
        ],
        payer: {
          email: email
        },
        external_reference: reference || `DENTAL_${Date.now()}`,
        notification_url: `${req.protocol}://${req.get('host')}/api/payments/mercadopago/webhook`,
        back_urls: {
          success: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment-success`,
          failure: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment-failure`,
          pending: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment-pending`
        },
        auto_return: 'approved',
        binary_mode: true,
        metadata: {
          service_id: service_id,
          patient_id: patient_id
        }
      };

      // Crear preferencia con API de MercadoPago
      axios.post('https://api.mercadopago.com/checkout/preferences', preferenceData, {
        headers: {
          'Authorization': `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      })
      .then(response => {
        console.log('🦷 Preferencia MercadoPago creada:', response.data.id);
        
        res.json({
          preference_id: response.data.id,
          init_point: response.data.init_point,
          sandbox_init_point: response.data.sandbox_init_point,
          public_key: config.publicKey
        });
      })
      .catch(error => {
        console.error('❌ Error creando preferencia MercadoPago:', error);
        res.status(500).json({
          error: 'Error interno del servidor',
          details: error.response?.data || error.message
        });
      });
    });

  } catch (error) {
    handleQueryError(error, res, "crear preferencia MercadoPago");
  }
});

// Webhook para MercadoPago
router.post('/mercadopago/webhook', (req, res) => {
  try {
    const { type, data } = req.body;
    
    console.log('🔔 Webhook MercadoPago recibido:', { type, data });

    if (type === 'payment') {
      // Obtener configuración dinámica
      getMercadoPagoConfig('sandbox', (err, config) => {
        if (err || !config) {
          console.error('Configuración de MercadoPago no disponible');
          return res.status(500).send('Config Error');
        }

        // Obtener información del pago
        axios.get(`https://api.mercadopago.com/v1/payments/${data.id}`, {
          headers: {
            'Authorization': `Bearer ${config.accessToken}`
          },
          timeout: 10000
        })
        .then(paymentResponse => {
          const paymentData = paymentResponse.data;
          console.log('💳 Estado del pago:', paymentData.status);
          
          // Procesar según el estado del pago
          switch (paymentData.status) {
            case 'approved':
              // Pago aprobado - actualizar base de datos
              procesarPagoAprobado({
                platform: 'mercadopago',
                payment_id: paymentData.id,
                external_reference: paymentData.external_reference,
                amount: paymentData.transaction_amount,
                original_amount_mxn: paymentData.transaction_amount,
                currency: 'MXN',
                status: 'approved',
                payment_method: paymentData.payment_method_id,
                payer_email: paymentData.payer?.email,
                service_id: paymentData.metadata?.service_id,
                patient_id: paymentData.metadata?.patient_id
              }, (saveErr) => {
                if (saveErr) {
                  console.error('Error guardando pago:', saveErr);
                }
              });
              break;
            
            case 'rejected':
              // Pago rechazado
              procesarPagoRechazado({
                platform: 'mercadopago',
                payment_id: paymentData.id,
                external_reference: paymentData.external_reference,
                reason: paymentData.status_detail
              }, (rejectErr) => {
                if (rejectErr) {
                  console.error('Error procesando rechazo:', rejectErr);
                }
              });
              break;
          }
          
          res.status(200).send('OK');
        })
        .catch(error => {
          console.error('❌ Error obteniendo pago MercadoPago:', error);
          res.status(500).send('Error');
        });
      });
    } else {
      res.status(200).send('OK');
    }

  } catch (error) {
    console.error('❌ Error en webhook MercadoPago:', error);
    res.status(500).send('Error');
  }
});

// ==================== PAYPAL ====================

// Crear orden de pago en PayPal
router.post('/paypal/create-order', (req, res) => {
  try {
    const { 
      amount, 
      title, 
      reference,
      service_id,
      patient_id,
      environment = 'sandbox'
    } = req.body;

    // Validar datos requeridos
    if (!amount || !title) {
      return res.status(400).json({
        error: 'Faltan datos requeridos: amount, title'
      });
    }

    // Obtener configuración dinámica
    getPayPalConfig(environment, (err, config) => {
      if (err) return handleQueryError(err, res, "obtener configuración PayPal");
      
      if (!config || !config.enabled) {
        return res.status(400).json({
          error: 'PayPal no está configurado o habilitado'
        });
      }

      // Obtener token de acceso
      const auth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
      
      axios.post(`${config.baseUrl}/v1/oauth2/token`, 
        'grant_type=client_credentials',
        {
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: 10000
        }
      )
      .then(tokenResponse => {
        const accessToken = tokenResponse.data.access_token;

        // Convertir MXN a USD
        const amountUSD = convertMXNToUSD(amount);

        // Crear orden
        const orderData = {
          intent: 'CAPTURE',
          purchase_units: [{
            reference_id: reference || `DENTAL_${Date.now()}`,
            description: title,
            amount: {
              currency_code: 'USD',
              value: amountUSD
            },
            custom_id: JSON.stringify({
              service_id,
              patient_id,
              original_amount_mxn: amount
            })
          }],
          application_context: {
            return_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment-success`,
            cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment-cancel`,
            brand_name: 'Clínica Dental',
            landing_page: 'BILLING',
            user_action: 'PAY_NOW'
          }
        };

        axios.post(`${config.baseUrl}/v2/checkout/orders`, orderData, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        })
        .then(orderResponse => {
          console.log('🦷 Orden PayPal creada:', orderResponse.data.id);
          
          res.json({
            order_id: orderResponse.data.id,
            status: orderResponse.data.status,
            amount_usd: amountUSD,
            original_amount_mxn: amount,
            approve_url: orderResponse.data.links?.find(link => link.rel === 'approve')?.href
          });
        })
        .catch(orderError => {
          console.error('❌ Error creando orden PayPal:', orderError);
          res.status(500).json({
            error: 'Error creando orden PayPal',
            details: orderError.response?.data || orderError.message
          });
        });
      })
      .catch(tokenError => {
        console.error('❌ Error obteniendo token PayPal:', tokenError);
        res.status(500).json({
          error: 'Error de autenticación PayPal',
          details: tokenError.response?.data || tokenError.message
        });
      });
    });

  } catch (error) {
    handleQueryError(error, res, "crear orden PayPal");
  }
});

// Capturar pago de PayPal
router.post('/paypal/capture-order', (req, res) => {
  try {
    const { orderID, environment = 'sandbox' } = req.body;

    if (!orderID) {
      return res.status(400).json({
        error: 'orderID es requerido'
      });
    }

    // Obtener configuración dinámica
    getPayPalConfig(environment, (err, config) => {
      if (err) return handleQueryError(err, res, "obtener configuración PayPal para captura");
      
      if (!config || !config.enabled) {
        return res.status(400).json({
          error: 'PayPal no está configurado'
        });
      }

      // Obtener token de acceso
      const auth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
      
      axios.post(`${config.baseUrl}/v1/oauth2/token`, 
        'grant_type=client_credentials',
        {
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: 10000
        }
      )
      .then(tokenResponse => {
        const accessToken = tokenResponse.data.access_token;

        // Capturar orden
        axios.post(`${config.baseUrl}/v2/checkout/orders/${orderID}/capture`, {}, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        })
        .then(captureResponse => {
          const captureData = captureResponse.data;
          console.log('💰 Pago PayPal capturado:', captureData.id);
          
          // Procesar pago capturado
          if (captureData.status === 'COMPLETED') {
            const customData = JSON.parse(captureData.purchase_units[0].custom_id || '{}');
            
            procesarPagoAprobado({
              platform: 'paypal',
              payment_id: captureData.id,
              external_reference: captureData.purchase_units[0].reference_id,
              amount: captureData.purchase_units[0].payments.captures[0].amount.value,
              currency: 'USD',
              original_amount_mxn: customData.original_amount_mxn,
              status: 'completed',
              payment_method: 'paypal',
              service_id: customData.service_id,
              patient_id: customData.patient_id
            }, (saveErr) => {
              if (saveErr) {
                console.error('Error guardando pago PayPal:', saveErr);
              }
            });
          }

          res.json(captureData);
        })
        .catch(captureError => {
          console.error('❌ Error capturando orden PayPal:', captureError);
          res.status(500).json({
            error: 'Error capturando pago PayPal',
            details: captureError.response?.data || captureError.message
          });
        });
      })
      .catch(tokenError => {
        console.error('❌ Error obteniendo token PayPal para captura:', tokenError);
        res.status(500).json({
          error: 'Error de autenticación PayPal',
          details: tokenError.response?.data || tokenError.message
        });
      });
    });

  } catch (error) {
    handleQueryError(error, res, "capturar orden PayPal");
  }
});

// ==================== ENDPOINTS ADICIONALES ====================

// Obtener estado de pago
router.get('/status/:platform/:paymentId', (req, res) => {
  try {
    const { platform, paymentId } = req.params;
    const { environment = 'sandbox' } = req.query;

    if (platform === 'mercadopago') {
      getMercadoPagoConfig(environment, (err, config) => {
        if (err) return handleQueryError(err, res, "obtener configuración MercadoPago para status");
        
        if (!config) {
          return res.status(400).json({ error: 'MercadoPago no configurado' });
        }

        axios.get(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
          headers: {
            'Authorization': `Bearer ${config.accessToken}`
          },
          timeout: 10000
        })
        .then(response => {
          res.json({
            status: response.data.status,
            amount: response.data.transaction_amount,
            payment_method: response.data.payment_method_id,
            currency: 'MXN'
          });
        })
        .catch(error => {
          console.error('❌ Error obteniendo estado MercadoPago:', error);
          res.status(500).json({
            error: 'Error obteniendo estado de pago',
            details: error.message
          });
        });
      });
    } else if (platform === 'paypal') {
      getPayPalConfig(environment, (err, config) => {
        if (err) return handleQueryError(err, res, "obtener configuración PayPal para status");
        
        if (!config) {
          return res.status(400).json({ error: 'PayPal no configurado' });
        }

        // Obtener token y consultar orden
        const auth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
        
        axios.post(`${config.baseUrl}/v1/oauth2/token`, 
          'grant_type=client_credentials',
          {
            headers: {
              'Authorization': `Basic ${auth}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 10000
          }
        )
        .then(tokenResponse => {
          const accessToken = tokenResponse.data.access_token;

          axios.get(`${config.baseUrl}/v2/checkout/orders/${paymentId}`, {
            headers: {
              'Authorization': `Bearer ${accessToken}`
            },
            timeout: 10000
          })
          .then(orderResponse => {
            res.json({
              status: orderResponse.data.status,
              amount: orderResponse.data.purchase_units[0].amount.value,
              currency: 'USD'
            });
          })
          .catch(error => {
            console.error('❌ Error obteniendo orden PayPal:', error);
            res.status(500).json({
              error: 'Error obteniendo estado de orden',
              details: error.message
            });
          });
        })
        .catch(error => {
          console.error('❌ Error obteniendo token PayPal para status:', error);
          res.status(500).json({
            error: 'Error de autenticación PayPal',
            details: error.message
          });
        });
      });
    } else {
      res.status(400).json({ error: 'Plataforma no válida' });
    }

  } catch (error) {
    handleQueryError(error, res, "obtener estado de pago");
  }
});

// Endpoint de prueba
router.get('/test', (req, res) => {
  res.json({
    message: '🦷 API de Pagos Dental funcionando',
    mercadopago: 'Configurado dinámicamente ✅',
    paypal: 'Configurado dinámicamente ✅',
    timestamp: new Date().toISOString(),
    endpoints: {
      mercadopago: '/mercadopago/create-preference, /mercadopago/webhook',
      paypal: '/paypal/create-order, /paypal/capture-order',
      status: '/status/:platform/:paymentId',
      test: '/test'
    },
    configuration: 'Usando tabla config_payment ✅',
    style: 'Callbacks tradicionales ✅'
  });
});

module.exports = router;