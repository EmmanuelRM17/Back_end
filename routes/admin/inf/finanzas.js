const express = require("express");
const db = require("../../../db"); // Ruta a la conexión de base de datos
const router = express.Router();

// Función para manejar errores de consulta
const handleQueryError = (err, res, mensaje) => {
  console.error(`Error: ${mensaje}`, err);
  return res.status(500).json({ error: "Error interno del servidor" });
};

// Endpoint para obtener todos los pagos
router.get("/Pagos/", async (req, res) => {
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
router.get("/Pagos/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const query = `
      SELECT * FROM pagos WHERE id = ?;
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
router.post("/Pagos/", async (req, res) => {
  try {
    const {
      paciente_id, cita_id, factura_id, monto, subtotal, total,
      concepto, metodo_pago, fecha_pago, estado, comprobante, notas
    } = req.body;

    // Mapear métodos de pago del frontend a los de la BD
    const metodoPagoMapeado = mapearMetodoPago(metodo_pago);

    const query = `
      INSERT INTO pagos (
        paciente_id, cita_id, factura_id, monto, subtotal, total,
        concepto, metodo_pago, fecha_pago, estado, comprobante, notas
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;

    db.query(
      query,
      [paciente_id, cita_id || null, factura_id || null, monto, subtotal, total,
        concepto, metodoPagoMapeado, fecha_pago, estado, comprobante, notas],
      (err, results) => {
        if (err) return handleQueryError(err, res, "crear pago");

        // CORRECCIÓN: Actualizar estado_pago en lugar de estado
        if (cita_id) {
          const updateCitaQuery = `
            UPDATE citas 
            SET estado_pago = ? 
            WHERE id = ? AND estado = 'Completada';
          `;

          // Determinar el estado_pago según el monto
          const estadoPago = total >= monto ? 'Pagado' : 'Parcial';

          db.query(updateCitaQuery, [estadoPago, cita_id], (updateErr) => {
            if (updateErr) {
              console.error('Error actualizando estado_pago de cita:', updateErr);
            }
          });
        }

        res.status(201).json({
          id: results.insertId,
          message: "Pago registrado correctamente"
        });
      }
    );
  } catch (error) {
    handleQueryError(error, res, "registrar pago");
  }
});

// Endpoint para actualizar un pago
router.put("/Pagos/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      paciente_id, cita_id, factura_id, monto, subtotal, total,
      concepto, metodo_pago, fecha_pago, estado, comprobante, notas
    } = req.body;

    const metodoPago = metodo_pago;

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
      [paciente_id, cita_id || null, factura_id || null, monto, subtotal, total,
        concepto, metodoPagoMapeado, fecha_pago, estado, comprobante, notas, id],
      (err, results) => {
        if (err) return handleQueryError(err, res, `actualizar pago #${id}`);

        if (results.affectedRows === 0) {
          return res.status(404).json({ error: "Pago no encontrado" });
        }

        // CORRECCIÓN: Actualizar estado_pago
        if (cita_id && estado === 'Pagado') {
          const updateCitaQuery = `
            UPDATE citas 
            SET estado_pago = ? 
            WHERE id = ?;
          `;

          const estadoPago = total >= monto ? 'Pagado' : 'Parcial';

          db.query(updateCitaQuery, [estadoPago, cita_id]);
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
router.delete("/Pagos/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const query = "DELETE FROM pagos WHERE id = ?;";

    db.query(query, [id], (err, results) => {
      if (err) return handleQueryError(err, res, `eliminar pago #${id}`);

      if (results.affectedRows === 0) {
        return res.status(404).json({ error: "Pago no encontrado" });
      }

      res.json({ message: "Pago eliminado correctamente" });
    });
  } catch (error) {
    handleQueryError(error, res, "eliminar pago");
  }
});

module.exports = router;