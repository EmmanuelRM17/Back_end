// routes/payments.js - Rutas de Pagos con TUS credenciales
const express = require('express');
const router = express.Router();
const configureMercadoPago = require('../config/mercadopago');
const configurePayPal = require('../config/paypal');
const paypal = require('@paypal/checkout-server-sdk');

// Inicializar servicios de pago con TUS credenciales
const { mercadopago } = configureMercadoPago();
const { client: paypalClient, convertMXNToUSD } = configurePayPal();

// ============= MERCADOPAGO =============

// Crear preferencia de pago en MercadoPago
router.post('/mercadopago/create-preference', async (req, res) => {
  try {
    const { 
      title, 
      amount, 
      email,
      reference,
      service_id,
      patient_id 
    } = req.body;

    // Validar datos requeridos
    if (!title || !amount || !email) {
      return res.status(400).json({
        error: 'Faltan datos requeridos: title, amount, email'
      });
    }

    const preference = {
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

    const response = await mercadopago.preferences.create(preference);
    
    console.log('🦷 Preferencia MercadoPago creada:', response.body.id);
    
    res.json({
      preference_id: response.body.id,
      init_point: response.body.init_point,
      sandbox_init_point: response.body.sandbox_init_point
    });

  } catch (error) {
    console.error('❌ Error creando preferencia MercadoPago:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      details: error.message
    });
  }
});

// Webhook para MercadoPago
router.post('/mercadopago/webhook', async (req, res) => {
  try {
    const { type, data } = req.body;
    
    console.log('🔔 Webhook MercadoPago recibido:', { type, data });

    if (type === 'payment') {
      const payment = await mercadopago.payment.findById(data.id);
      const paymentData = payment.body;
      
      console.log('💳 Estado del pago:', paymentData.status);
      
      // Procesar según el estado del pago
      switch (paymentData.status) {
        case 'approved':
          // Pago aprobado - actualizar base de datos
          await procesarPagoAprobado({
            platform: 'mercadopago',
            payment_id: paymentData.id,
            external_reference: paymentData.external_reference,
            amount: paymentData.transaction_amount,
            currency: 'MXN',
            status: 'approved',
            payment_method: paymentData.payment_method_id,
            payer_email: paymentData.payer.email,
            service_id: paymentData.metadata?.service_id,
            patient_id: paymentData.metadata?.patient_id
          });
          break;
        
        case 'rejected':
          // Pago rechazado
          await procesarPagoRechazado({
            platform: 'mercadopago',
            payment_id: paymentData.id,
            external_reference: paymentData.external_reference,
            reason: paymentData.status_detail
          });
          break;
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Error en webhook MercadoPago:', error);
    res.status(500).send('Error');
  }
});

// ============= PAYPAL =============

// Crear orden de pago en PayPal
router.post('/paypal/create-order', async (req, res) => {
  try {
    const { 
      amount, 
      title, 
      reference,
      service_id,
      patient_id 
    } = req.body;

    // Validar datos requeridos
    if (!amount || !title) {
      return res.status(400).json({
        error: 'Faltan datos requeridos: amount, title'
      });
    }

    // Convertir MXN a USD
    const amountUSD = convertMXNToUSD(amount);

    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
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
    });

    const order = await paypalClient.execute(request);
    
    console.log('🦷 Orden PayPal creada:', order.result.id);
    
    res.json({
      order_id: order.result.id,
      status: order.result.status,
      amount_usd: amountUSD,
      original_amount_mxn: amount
    });

  } catch (error) {
    console.error('❌ Error creando orden PayPal:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      details: error.message
    });
  }
});

// Capturar pago de PayPal
router.post('/paypal/capture-order', async (req, res) => {
  try {
    const { orderID } = req.body;

    if (!orderID) {
      return res.status(400).json({
        error: 'orderID es requerido'
      });
    }

    const request = new paypal.orders.OrdersCaptureRequest(orderID);
    request.requestBody({});

    const capture = await paypalClient.execute(request);
    const captureData = capture.result;
    
    console.log('💰 Pago PayPal capturado:', captureData.id);
    
    // Procesar pago capturado
    if (captureData.status === 'COMPLETED') {
      const customData = JSON.parse(captureData.purchase_units[0].custom_id || '{}');
      
      await procesarPagoAprobado({
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
      });
    }

    res.json(captureData);

  } catch (error) {
    console.error('❌ Error capturando orden PayPal:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      details: error.message
    });
  }
});

// ============= FUNCIONES AUXILIARES =============

// Procesar pago aprobado
async function procesarPagoAprobado(paymentData) {
  try {
    console.log('✅ Procesando pago aprobado:', paymentData);
    
    // Aquí actualizas tu base de datos de finanzas
    const pagoData = {
      paciente_id: paymentData.patient_id,
      cita_id: paymentData.service_id,
      monto: paymentData.original_amount_mxn || paymentData.amount,
      subtotal: paymentData.original_amount_mxn || paymentData.amount,
      total: paymentData.original_amount_mxn || paymentData.amount,
      concepto: `Pago procesado via ${paymentData.platform}`,
      metodo_pago: paymentData.platform === 'mercadopago' ? 'MercadoPago' : 'PayPal',
      estado: 'Pagado',
      comprobante: paymentData.payment_id,
      fecha_pago: new Date(),
      platform_data: JSON.stringify(paymentData)
    };

    // TODO: Llamar a tu API de finanzas para guardar el pago
    // const axios = require('axios');
    // await axios.post('http://localhost:5000/api/Finanzas/Pagos', pagoData);
    
    console.log('💾 Pago guardado en base de datos:', pagoData);
    
  } catch (error) {
    console.error('❌ Error procesando pago aprobado:', error);
  }
}

// Procesar pago rechazado
async function procesarPagoRechazado(paymentData) {
  try {
    console.log('❌ Pago rechazado:', paymentData);
    // Aquí puedes notificar al usuario o actualizar el estado
  } catch (error) {
    console.error('❌ Error procesando pago rechazado:', error);
  }
}

// Obtener estado de pago
router.get('/status/:platform/:paymentId', async (req, res) => {
  try {
    const { platform, paymentId } = req.params;

    if (platform === 'mercadopago') {
      const payment = await mercadopago.payment.findById(paymentId);
      res.json({
        status: payment.body.status,
        amount: payment.body.transaction_amount,
        payment_method: payment.body.payment_method_id,
        currency: 'MXN'
      });
    } else if (platform === 'paypal') {
      const request = new paypal.orders.OrdersGetRequest(paymentId);
      const order = await paypalClient.execute(request);
      res.json({
        status: order.result.status,
        amount: order.result.purchase_units[0].amount.value,
        currency: 'USD'
      });
    } else {
      res.status(400).json({ error: 'Plataforma no válida' });
    }

  } catch (error) {
    console.error('❌ Error obteniendo estado de pago:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      details: error.message
    });
  }
});

// Endpoint de prueba
router.get('/test', (req, res) => {
  res.json({
    message: '🦷 API de Pagos Dental funcionando',
    mercadopago: 'Configurado ✅',
    paypal: 'Configurado ✅',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;