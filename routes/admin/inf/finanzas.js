const express = require("express");
const db = require("../../../db");
const router = express.Router();

// Variables para pagos online (opcional)
let mercadopagoPreference = null;
let paypalClient = null;
let convertMXNToUSD = null;

// Intentar cargar configuraciones de pagos online
try {
  const configureMercadoPago = require("../../../config/mercadopago");
  const configurePayPal = require("../../../config/paypal");
  const paypal = require('@paypal/checkout-server-sdk');
  
  const mercadopagoConfig = configureMercadoPago();
  const paypalConfig = configurePayPal();
  
  mercadopagoPreference = mercadopagoConfig.preference;
  paypalClient = paypalConfig.client;
  convertMXNToUSD = paypalConfig.convertMXNToUSD;
  
  console.log('✅ Pagos online configurados (MercadoPago + PayPal)');
} catch (error) {
  console.log('ℹ️ Pagos online no configurados - solo efectivo disponible');
}

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

    // ✅ VERIFICAR SI YA EXISTE UN PAGO PARA ESTA CITA
    const checkQuery = `SELECT id FROM pagos WHERE cita_id = ? LIMIT 1`;
    
    db.query(checkQuery, [cita_id], (checkErr, checkResults) => {
      if (checkErr) return handleQueryError(checkErr, res, "verificar pago existente");
      
      const metodoPagoMapeado = mapearMetodoPago(metodo_pago);
      
      if (checkResults.length > 0) {
        // ✅ ACTUALIZAR PAGO EXISTENTE
        const pagoExistenteId = checkResults[0].id;
        const updateQuery = `
          UPDATE pagos SET 
            paciente_id = ?, factura_id = ?, monto = ?, subtotal = ?, total = ?,
            concepto = ?, metodo_pago = ?, fecha_pago = ?, estado = ?, 
            comprobante = ?, notas = ?, fecha_actualizacion = NOW()
          WHERE id = ?
        `;
        
        db.query(updateQuery, [
          paciente_id, factura_id || null, monto, subtotal || monto, total || monto,
          concepto, metodoPagoMapeado, fecha_pago || new Date(), estado || 'Pagado',
          comprobante || `${metodoPagoMapeado}-${Date.now()}`, notas || '', pagoExistenteId
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
          paciente_id, cita_id || null, factura_id || null, monto, 
          subtotal || monto, total || monto, concepto, metodoPagoMapeado, 
          fecha_pago || new Date(), estado || 'Pagado', 
          comprobante || `${metodoPagoMapeado}-${Date.now()}`, notas || ''
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
    handleQueryError(error, res, "procesar pago");
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

module.exports = router;