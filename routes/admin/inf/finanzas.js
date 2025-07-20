const express = require("express");
const db = require("../../../db");
const router = express.Router();
const { getPaymentConfig } = require('../../../utils/configPayment');

const paypalSDK = require('@paypal/checkout-server-sdk');
const { MercadoPagoConfig, Preference } = require('mercadopago');

// Función para manejar errores de consulta
const handleQueryError = (err, res, mensaje) => {
  console.error(`Error: ${mensaje}`, err);
  return res.status(500).json({ error: "Error interno del servidor" });
};

// Función para mapear métodos de pago según tu BD
const mapearMetodoPago = (metodo) => {
  const mapeo = {
    'Efectivo': 'Efectivo',
    'MercadoPago': 'MercadoPago',
    'PayPal': 'PayPal'
  };
  return mapeo[metodo] || 'Efectivo';
};


// Función para guardar configuración específica
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

// Función para obtener configuración específica
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
}

// Endpoint para obtener todos los pagos
router.get("/Pagos/", (req, res) => {
  try {
    const query = `
      SELECT p.*, 
             CONCAT(pac.nombre, ' ', pac.aPaterno) AS paciente_nombre,
             c.servicio_nombre, 
             c.fecha_consulta
      FROM pagos p
      LEFT JOIN pacientes pac ON p.paciente_id = pac.id
      LEFT JOIN citas c ON p.cita_id = c.id
      ORDER BY p.fecha_pago DESC;
    `;

    db.query(query, (err, results) => {
      if (err) return handleQueryError(err, res, "obtener pagos");
      res.json(results);
    });
  } catch (error) {
    handleQueryError(error, res, "consulta de pagos");
  }
});

// Endpoint para hacer lo de pagos 
router.post("/Pagos/upsert", (req, res) => {
  try {
    const {
      paciente_id, cita_id, factura_id, monto, subtotal, total,
      concepto, metodo_pago, fecha_pago, estado, comprobante, notas
    } = req.body;

    // Validar datos requeridos
    if (!paciente_id || !monto || !concepto || !metodo_pago) {
      return res.status(400).json({ 
        error: "Faltan datos requeridos: paciente_id, monto, concepto, metodo_pago" 
      });
    }

    // Mapear método de pago
    const metodoPagoMapeado = mapearMetodoPago(metodo_pago);

    // ✅ VERIFICAR SI YA EXISTE UN PAGO PARA ESTA CITA
    const checkQuery = `SELECT id FROM pagos WHERE cita_id = ? LIMIT 1`;
    
    db.query(checkQuery, [cita_id], (checkErr, checkResults) => {
      if (checkErr) return handleQueryError(checkErr, res, "verificar pago existente");
      
      if (checkResults.length > 0) {
        // ✅ ACTUALIZAR PAGO EXISTENTE
        const pagoExistenteId = checkResults[0].id;
        const updateQuery = `
          UPDATE pagos SET 
            paciente_id = ?, factura_id = ?, monto = ?, subtotal = ?, total = ?,
            concepto = ?, metodo_pago = ?, fecha_pago = ?, estado = ?, 
            comprobante = ?, notas = ?, fecha_actualizacion = CURRENT_TIMESTAMP
          WHERE id = ?
        `;
        
        db.query(updateQuery, [
          paciente_id, 
          factura_id || null, 
          monto, 
          subtotal || monto, 
          total || monto,
          concepto, 
          metodoPagoMapeado, 
          fecha_pago || new Date(), 
          estado || 'Pagado',
          comprobante || `${metodoPagoMapeado}-${Date.now()}`, 
          notas || '', 
          pagoExistenteId
        ], (updateErr, updateResults) => {
          if (updateErr) return handleQueryError(updateErr, res, "actualizar pago");
          
          // Actualizar estado_pago de la cita
          actualizarEstadoCita(cita_id, total || monto, monto);
          
          res.status(200).json({
            id: pagoExistenteId,
            message: "Pago actualizado correctamente",
            metodo_pago: metodoPagoMapeado,
            action: 'updated'
          });
        });
        
      } else {
        // ✅ CREAR PAGO NUEVO (código original)
        const insertQuery = `
          INSERT INTO pagos (
            paciente_id, cita_id, factura_id, monto, subtotal, total,
            concepto, metodo_pago, fecha_pago, estado, comprobante, notas
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        db.query(insertQuery, [
          paciente_id, 
          cita_id || null, 
          factura_id || null, 
          monto, 
          subtotal || monto, 
          total || monto,
          concepto, 
          metodoPagoMapeado, 
          fecha_pago || new Date(), 
          estado || 'Pagado', 
          comprobante || `${metodoPagoMapeado}-${Date.now()}`, 
          notas || ''
        ], (insertErr, insertResults) => {
          if (insertErr) return handleQueryError(insertErr, res, "crear pago");
          
          // Actualizar estado_pago de la cita
          actualizarEstadoCita(cita_id, total || monto, monto);
          
          res.status(201).json({
            id: insertResults.insertId,
            message: "Pago registrado correctamente",
            metodo_pago: metodoPagoMapeado,
            action: 'created'
          });
        });
      }
    });
    
  } catch (error) {
    handleQueryError(error, res, "procesar pago upsert");
  }
});

// Función helper para actualizar estado de cita
function actualizarEstadoCita(cita_id, totalPagado, montoCita) {
  if (!cita_id) return;
  
  const estadoPago = (parseFloat(totalPagado) >= parseFloat(montoCita)) ? 'Pagado' : 'Parcial';
  const updateCitaQuery = `UPDATE citas SET estado_pago = ? WHERE id = ?`;
  
  db.query(updateCitaQuery, [estadoPago, cita_id], (updateErr) => {
    if (updateErr) {
      console.error('Error actualizando estado_pago de cita:', updateErr);
    } else {
      console.log(`✅ Cita ${cita_id} actualizada a estado_pago: ${estadoPago}`);
    }
  });
}

// Endpoint para obtener un pago específico
router.get("/Pagos/:id", (req, res) => {
  try {
    const { id } = req.params;
    const query = `
      SELECT p.*, 
             CONCAT(pac.nombre, ' ', pac.aPaterno) AS paciente_nombre,
             c.servicio_nombre, 
             c.fecha_consulta
      FROM pagos p
      LEFT JOIN pacientes pac ON p.paciente_id = pac.id
      LEFT JOIN citas c ON p.cita_id = c.id
      WHERE p.id = ?;
    `;

    db.query(query, [id], (err, results) => {
      if (err) return handleQueryError(err, res, `obtener pago #${id}`);

      if (results.length === 0) {
        return res.status(404).json({ error: "Pago no encontrado" });
      }

      res.json(results[0]);
    });
  } catch (error) {
    handleQueryError(error, res, "consulta de pago individual");
  }
});

// Endpoint para crear un nuevo pago
router.post("/Pagos/", (req, res) => {
  try {
    const {
      paciente_id, cita_id, factura_id, monto, subtotal, total,
      concepto, metodo_pago, fecha_pago, estado, comprobante, notas
    } = req.body;

    // Validar datos requeridos
    if (!paciente_id || !monto || !concepto || !metodo_pago) {
      return res.status(400).json({ 
        error: "Faltan datos requeridos: paciente_id, monto, concepto, metodo_pago" 
      });
    }

    // Mapear método de pago
    const metodoPagoMapeado = mapearMetodoPago(metodo_pago);

    const query = `
      INSERT INTO pagos (
        paciente_id, cita_id, factura_id, monto, subtotal, total,
        concepto, metodo_pago, fecha_pago, estado, comprobante, notas
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;

    db.query(
      query,
      [
        paciente_id, 
        cita_id || null, 
        factura_id || null, 
        monto, 
        subtotal || monto, 
        total || monto,
        concepto, 
        metodoPagoMapeado, 
        fecha_pago || new Date(), 
        estado || 'Pagado', 
        comprobante || `${metodoPagoMapeado}-${Date.now()}`, 
        notas || ''
      ],
      (err, results) => {
        if (err) return handleQueryError(err, res, "crear pago");

        // Actualizar estado_pago de la cita si existe
        if (cita_id) {
          const updateCitaQuery = `
            UPDATE citas 
            SET estado_pago = ? 
            WHERE id = ?;
          `;

          const estadoPago = (parseFloat(total || monto) >= parseFloat(monto)) ? 'Pagado' : 'Parcial';

          db.query(updateCitaQuery, [estadoPago, cita_id], (updateErr) => {
            if (updateErr) {
              console.error('Error actualizando estado_pago de cita:', updateErr);
            } else {
              console.log(`✅ Cita ${cita_id} actualizada a estado_pago: ${estadoPago}`);
            }
          });
        }

        res.status(201).json({
          id: results.insertId,
          message: "Pago registrado correctamente",
          metodo_pago: metodoPagoMapeado
        });
      }
    );
  } catch (error) {
    handleQueryError(error, res, "registrar pago");
  }
});

// Endpoint para actualizar un pago
router.put("/Pagos/:id", (req, res) => {
  try {
    const { id } = req.params;
    const {
      paciente_id, cita_id, factura_id, monto, subtotal, total,
      concepto, metodo_pago, fecha_pago, estado, comprobante, notas
    } = req.body;

    const metodoPagoMapeado = mapearMetodoPago(metodo_pago);

    const query = `
      UPDATE pagos SET
        paciente_id = ?,
        cita_id = ?,
        factura_id = ?,
        monto = ?,
        subtotal = ?,
        total = ?,
        concepto = ?,
        metodo_pago = ?,
        fecha_pago = ?,
        estado = ?,
        comprobante = ?,
        notas = ?,
        fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id = ?;
    `;

    db.query(
      query,
      [
        paciente_id, 
        cita_id || null, 
        factura_id || null, 
        monto, 
        subtotal || monto, 
        total || monto,
        concepto, 
        metodoPagoMapeado, 
        fecha_pago, 
        estado, 
        comprobante, 
        notas, 
        id
      ],
      (err, results) => {
        if (err) return handleQueryError(err, res, `actualizar pago #${id}`);

        if (results.affectedRows === 0) {
          return res.status(404).json({ error: "Pago no encontrado" });
        }

        // Actualizar estado_pago de la cita si existe y está pagado
        if (cita_id && estado === 'Pagado') {
          const updateCitaQuery = `
            UPDATE citas 
            SET estado_pago = ? 
            WHERE id = ?;
          `;

          const estadoPago = (parseFloat(total || monto) >= parseFloat(monto)) ? 'Pagado' : 'Parcial';

          db.query(updateCitaQuery, [estadoPago, cita_id], (updateErr) => {
            if (updateErr) {
              console.error('Error actualizando estado_pago de cita:', updateErr);
            }
          });
        }

        res.json({
          id: parseInt(id),
          message: "Pago actualizado correctamente"
        });
      }
    );
  } catch (error) {
    handleQueryError(error, res, "actualizar pago");
  }
});

// Endpoint para eliminar un pago
router.delete("/Pagos/:id", (req, res) => {
  try {
    const { id } = req.params;
    
    // Primero obtener info del pago antes de eliminarlo
    const selectQuery = "SELECT cita_id FROM pagos WHERE id = ?;";
    
    db.query(selectQuery, [id], (selectErr, selectResults) => {
      if (selectErr) return handleQueryError(selectErr, res, `obtener info pago #${id}`);
      
      if (selectResults.length === 0) {
        return res.status(404).json({ error: "Pago no encontrado" });
      }
      
      const citaId = selectResults[0].cita_id;
      
      // Eliminar el pago
      const deleteQuery = "DELETE FROM pagos WHERE id = ?;";
      
      db.query(deleteQuery, [id], (deleteErr, deleteResults) => {
        if (deleteErr) return handleQueryError(deleteErr, res, `eliminar pago #${id}`);

        // Si tenía cita asociada, actualizar estado a Pendiente
        if (citaId) {
          const updateCitaQuery = `
            UPDATE citas 
            SET estado_pago = 'Pendiente' 
            WHERE id = ?;
          `;
          
          db.query(updateCitaQuery, [citaId], (updateErr) => {
            if (updateErr) {
              console.error('Error actualizando estado_pago de cita tras eliminar pago:', updateErr);
            }
          });
        }

        res.json({ 
          message: "Pago eliminado correctamente",
          cita_actualizada: citaId ? true : false
        });
      });
    });
  } catch (error) {
    handleQueryError(error, res, "eliminar pago");
  }
});

// MERCADOPAGO - Crear preferencia
router.post("/MercadoPago/crear-preferencia", (req, res) => {
  if (!mercadopagoPreference) {
    return res.status(503).json({
      error: 'MercadoPago no está configurado. Verifique las credenciales.'
    });
  }

  try {
    const { 
      paciente_id, cita_id, monto, concepto, email_paciente 
    } = req.body;

    // Validar datos requeridos
    if (!paciente_id || !cita_id || !monto || !email_paciente) {
      return res.status(400).json({
        error: 'Faltan datos requeridos: paciente_id, cita_id, monto, email_paciente'
      });
    }

    const preferenceData = {
      items: [
        {
          title: concepto || 'Pago de servicio dental',
          quantity: 1,
          unit_price: parseFloat(monto),
          currency_id: 'MXN'
        }
      ],
      payer: {
        email: email_paciente
      },
      external_reference: `DENTAL_${cita_id}_${Date.now()}`,
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment-success`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment-failure`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment-pending`
      },
      auto_return: 'approved',
      binary_mode: true,
      metadata: {
        paciente_id: paciente_id.toString(),
        cita_id: cita_id.toString()
      }
    };

    mercadopagoPreference.create({ body: preferenceData })
      .then(response => {
        console.log('🦷 Preferencia MercadoPago creada:', response.id);
        
        res.json({
          preference_id: response.id,
          init_point: response.init_point,
          external_reference: preferenceData.external_reference
        });
      })
      .catch(error => {
        console.error('❌ Error creando preferencia MercadoPago:', error);
        res.status(500).json({
          error: 'Error creando preferencia de pago',
          details: error.message
        });
      });

  } catch (error) {
    console.error('❌ Error en crear-preferencia:', error);
    res.status(500).json({
      error: 'Error procesando solicitud MercadoPago',
      details: error.message
    });
  }
});

// PAYPAL - Crear orden
router.post("/PayPal/crear-orden", (req, res) => {
  if (!paypalClient) {
    return res.status(503).json({
      error: 'PayPal no está configurado. Verifique las credenciales.'
    });
  }

  try {
    const { 
      paciente_id, cita_id, monto, concepto 
    } = req.body;

    // Validar datos requeridos
    if (!paciente_id || !cita_id || !monto) {
      return res.status(400).json({
        error: 'Faltan datos requeridos: paciente_id, cita_id, monto'
      });
    }

    // Convertir MXN a USD
    const amountUSD = convertMXNToUSD(monto);
    const { paypal } = require('@paypal/checkout-server-sdk');
    
    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: `DENTAL_${cita_id}_${Date.now()}`,
        description: concepto || 'Pago de servicio dental',
        amount: {
          currency_code: 'USD',
          value: amountUSD
        },
        custom_id: JSON.stringify({
          paciente_id,
          cita_id,
          original_amount_mxn: monto
        })
      }]
    });

    paypalClient.execute(request)
      .then(order => {
        console.log('🦷 Orden PayPal creada:', order.result.id);
        
        res.json({
          order_id: order.result.id,
          status: order.result.status,
          amount_usd: amountUSD,
          original_amount_mxn: monto
        });
      })
      .catch(error => {
        console.error('❌ Error creando orden PayPal:', error);
        res.status(500).json({
          error: 'Error creando orden PayPal',
          details: error.message
        });
      });

  } catch (error) {
    console.error('❌ Error en crear-orden PayPal:', error);
    res.status(500).json({
      error: 'Error procesando solicitud PayPal',
      details: error.message
    });
  }
});

// PAYPAL - Capturar pago
router.post("/PayPal/capturar-orden", (req, res) => {
  if (!paypalClient) {
    return res.status(503).json({
      error: 'PayPal no está configurado'
    });
  }

  try {
    const { orderID } = req.body;

    if (!orderID) {
      return res.status(400).json({
        error: 'orderID es requerido'
      });
    }

    const { paypal } = require('@paypal/checkout-server-sdk');
    const request = new paypal.orders.OrdersCaptureRequest(orderID);
    request.requestBody({});

    paypalClient.execute(request)
      .then(capture => {
        const captureData = capture.result;
        console.log('💰 Pago PayPal capturado:', captureData.id);
        
        // Guardar pago automáticamente en la BD si está completado
        if (captureData.status === 'COMPLETED') {
          const customData = JSON.parse(captureData.purchase_units[0].custom_id || '{}');
          
          const pagoData = {
            paciente_id: parseInt(customData.paciente_id),
            cita_id: parseInt(customData.cita_id),
            monto: parseFloat(customData.original_amount_mxn),
            subtotal: parseFloat(customData.original_amount_mxn),
            total: parseFloat(customData.original_amount_mxn),
            concepto: 'Pago online vía PayPal',
            metodo_pago: 'PayPal',
            fecha_pago: new Date(),
            estado: 'Pagado',
            comprobante: captureData.id,
            notas: `Pago automático. Referencia: ${captureData.purchase_units[0].reference_id}`
          };

          const insertQuery = `
            INSERT INTO pagos (
              paciente_id, cita_id, monto, subtotal, total,
              concepto, metodo_pago, fecha_pago, estado, comprobante, notas
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
          `;

          db.query(
            insertQuery,
            [
              pagoData.paciente_id, pagoData.cita_id, pagoData.monto, 
              pagoData.subtotal, pagoData.total, pagoData.concepto, 
              pagoData.metodo_pago, pagoData.fecha_pago, pagoData.estado, 
              pagoData.comprobante, pagoData.notas
            ],
            (err, results) => {
              if (err) {
                console.error('❌ Error guardando pago PayPal:', err);
              } else {
                console.log('✅ Pago PayPal guardado con ID:', results.insertId);
                
                // Actualizar estado de la cita
                const updateCitaQuery = `
                  UPDATE citas 
                  SET estado_pago = 'Pagado' 
                  WHERE id = ?;
                `;
                
                db.query(updateCitaQuery, [pagoData.cita_id], (updateErr) => {
                  if (updateErr) {
                    console.error('Error actualizando cita PayPal:', updateErr);
                  } else {
                    console.log('✅ Cita actualizada tras pago PayPal');
                  }
                });
              }
            }
          );
        }

        res.json(captureData);
      })
      .catch(error => {
        console.error('❌ Error capturando orden PayPal:', error);
        res.status(500).json({
          error: 'Error capturando pago PayPal',
          details: error.message
        });
      });

  } catch (error) {
    console.error('❌ Error en capturar-orden:', error);
    res.status(500).json({
      error: 'Error procesando captura PayPal',
      details: error.message
    });
  }
});

// Endpoint de estado del sistema
router.get("/estado", (req, res) => {
  res.json({
    message: '🦷 Sistema de Finanzas funcionando correctamente',
    pagos_efectivo: 'Disponible ✅',
    pagos_mercadopago: mercadopagoPreference ? 'Configurado ✅' : 'No configurado ❌',
    pagos_paypal: paypalClient ? 'Configurado ✅' : 'No configurado ❌',
    metodos_permitidos: ['Efectivo', 'MercadoPago', 'PayPal'],
    timestamp: new Date().toISOString(),
    version: '2.0.0'
  });
});

// Endpoint para obtener estadísticas de pagos
router.get("/estadisticas", (req, res) => {
  try {
    const queries = {
      totalPagos: "SELECT COUNT(*) as total FROM pagos;",
      totalMonto: "SELECT SUM(total) as monto FROM pagos WHERE estado = 'Pagado';",
      porMetodo: `
        SELECT metodo_pago, COUNT(*) as cantidad, SUM(total) as monto_total 
        FROM pagos 
        WHERE estado = 'Pagado' 
        GROUP BY metodo_pago;
      `,
      citasPendientes: "SELECT COUNT(*) as total FROM citas WHERE estado_pago = 'Pendiente';"
    };

    // Ejecutar consultas
    db.query(queries.totalPagos, (err1, resultTotal) => {
      if (err1) return handleQueryError(err1, res, "estadísticas total pagos");
      
      db.query(queries.totalMonto, (err2, resultMonto) => {
        if (err2) return handleQueryError(err2, res, "estadísticas monto");
        
        db.query(queries.porMetodo, (err3, resultMetodos) => {
          if (err3) return handleQueryError(err3, res, "estadísticas por método");
          
          db.query(queries.citasPendientes, (err4, resultPendientes) => {
            if (err4) return handleQueryError(err4, res, "estadísticas pendientes");
            
            res.json({
              total_pagos: resultTotal[0].total,
              monto_total_pagado: parseFloat(resultMonto[0].monto || 0),
              por_metodo: resultMetodos,
              citas_pendientes: resultPendientes[0].total,
              fecha_consulta: new Date().toISOString()
            });
          });
        });
      });
    });
  } catch (error) {
    handleQueryError(error, res, "obtener estadísticas");
  }
});

// GET - Obtener configuración actual
router.get('/config', (req, res) => {
  try {
    const query = `
      SELECT provider, setting_key, setting_value, environment, is_active 
      FROM config_payment 
      WHERE is_active = 1 AND environment = 'sandbox'
      ORDER BY provider, setting_key
    `;
    
    db.query(query, (err, results) => {
      if (err) {
        console.error('Error consultando configuración:', err);
        return res.status(500).json({ 
          error: 'Error consultando configuración',
          details: err.message 
        });
      }

      // Construir objeto de configuración
      const config = {
        mercadopago: {
          enabled: false,
          access_token: '',
          public_key: '',
          webhook_url: '',
          mode: 'sandbox'
        },
        paypal: {
          enabled: false,
          client_id: '',
          client_secret: '',
          webhook_url: '',
          mode: 'sandbox'
        }
      };

      // Llenar configuración desde BD
      results.forEach(row => {
        if (row.provider === 'mercadopago') {
          if (row.setting_key === 'enabled') {
            config.mercadopago.enabled = row.setting_value === 'true';
          } else if (row.setting_key === 'access_token') {
            config.mercadopago.access_token = row.setting_value || '';
          } else if (row.setting_key === 'public_key') {
            config.mercadopago.public_key = row.setting_value || '';
          } else if (row.setting_key === 'webhook_url') {
            config.mercadopago.webhook_url = row.setting_value || '';
          } else if (row.setting_key === 'mode') {
            config.mercadopago.mode = row.setting_value || 'sandbox';
          }
        } else if (row.provider === 'paypal') {
          if (row.setting_key === 'enabled') {
            config.paypal.enabled = row.setting_value === 'true';
          } else if (row.setting_key === 'client_id') {
            config.paypal.client_id = row.setting_value || '';
          } else if (row.setting_key === 'client_secret') {
            config.paypal.client_secret = row.setting_value || '';
          } else if (row.setting_key === 'webhook_url') {
            config.paypal.webhook_url = row.setting_value || '';
          } else if (row.setting_key === 'mode') {
            config.paypal.mode = row.setting_value || 'sandbox';
          }
        }
      });

      console.log('✅ Configuración cargada desde BD:', {
        mercadopago: {
          enabled: config.mercadopago.enabled,
          has_token: !!config.mercadopago.access_token,
          has_key: !!config.mercadopago.public_key
        },
        paypal: {
          enabled: config.paypal.enabled,
          has_client_id: !!config.paypal.client_id,
          has_secret: !!config.paypal.client_secret
        }
      });

      res.json({
        success: true,
        environment: 'sandbox',
        config: config
      });
    });
  } catch (error) {
    console.error('Error en /config:', error);
    res.status(500).json({ error: error.message });
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

// Endpoint temporal para debug
router.get('/debug-credentials', (req, res) => {
  try {
    const query = `
      SELECT provider, setting_key, setting_value, is_active, environment 
      FROM config_payment 
      WHERE provider IN ('mercadopago', 'paypal')
      ORDER BY provider, setting_key
    `;
    
    db.query(query, (err, results) => {
      if (err) {
        console.error('Error consultando credenciales:', err);
        return res.status(500).json({ error: 'Error consultando base de datos' });
      }

      // Agrupar por proveedor y ocultar datos sensibles
      const credentials = {};
      results.forEach(row => {
        if (!credentials[row.provider]) {
          credentials[row.provider] = {};
        }
        credentials[row.provider][row.setting_key] = {
          value: row.setting_value ? `${row.setting_value.substring(0, 15)}...` : 'VACÍO',
          is_active: row.is_active,
          environment: row.environment,
          length: row.setting_value ? row.setting_value.length : 0
        };
      });

      res.json({
        success: true,
        credentials,
        raw_count: results.length
      });
    });
  } catch (error) {
    console.error('Error en debug-credentials:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;