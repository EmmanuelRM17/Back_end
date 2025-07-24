const express = require("express");
const router = express.Router();
const db = require("../../../db");

// Obtener todos los intentos de login (pacientes, empleados, administradores)
router.get("/login-attempts", async (_req, res) => {
  try {
    const attemptsSql = `
      SELECT 
        id, 
        ip_address, 
        paciente_id, 
        empleado_id, 
        administrador_id, 
        fecha_hora, 
        exitoso, 
        intentos_fallidos, 
        fecha_bloqueo,
        CASE 
          WHEN paciente_id IS NOT NULL THEN 'paciente'
          WHEN empleado_id IS NOT NULL THEN 'empleado'
          WHEN administrador_id IS NOT NULL THEN 'administrador'
          ELSE 'unknown'
        END as tipo_usuario,
        COALESCE(paciente_id, empleado_id, administrador_id) as usuario_id
      FROM inf_login_attempts
      ORDER BY fecha_hora DESC
    `;

    db.query(attemptsSql, async (err, attempts) => {
      if (err) {
        return res.status(500).json({
          message: "Error al obtener los intentos de inicio de sesión.",
        });
      }

      // Obtener configuración de seguridad
      const maxAttemptsSql = 'SELECT setting_value FROM config WHERE setting_name = "MAX_ATTEMPTS"';
      const lockTimeSql = 'SELECT setting_value FROM config WHERE setting_name = "LOCK_TIME_MINUTES"';

      const maxAttempts = await new Promise((resolve, reject) => {
        db.query(maxAttemptsSql, (err, result) => {
          if (err) reject(err);
          else resolve(parseInt(result[0].setting_value, 10));
        });
      });

      const lockTimeMinutes = await new Promise((resolve, reject) => {
        db.query(lockTimeSql, (err, result) => {
          if (err) reject(err);
          else resolve(parseInt(result[0].setting_value, 10));
        });
      });

      res.status(200).json({
        attempts,
        maxAttempts,
        lockTimeMinutes,
      });
    });
  } catch (error) {
    res.status(500).json({ message: "Error en el servidor." });
  }
});

// Obtener información de usuario por ID y tipo
router.get("/usuario/:tipo/:id", (req, res) => {
  const { tipo, id } = req.params;

  // Validar tipo de usuario
  const tiposPermitidos = ['paciente', 'empleado', 'administrador'];
  if (!tiposPermitidos.includes(tipo)) {
    return res.status(400).json({ 
      error: "Tipo de usuario no válido. Debe ser: paciente, empleado o administrador" 
    });
  }

  // Determinar tabla y campos según el tipo
  let tabla, campos;
  
  switch (tipo) {
    case 'paciente':
      tabla = 'pacientes';
      campos = `id, nombre, aPaterno, aMaterno, fechaNacimiento, genero, 
                telefono, email, condiciones_medicas, estado, 'paciente' as tipo`;
      break;
    
    case 'empleado':
      tabla = 'empleados';
      campos = `id, nombre, aPaterno, aMaterno, telefono, email, 
                puesto, fecha_contratacion, estado, 'empleado' as tipo`;
      break;
    
    case 'administrador':
      tabla = 'administradores';
      campos = `id, nombre, email, fecha_creacion, estado, 'administrador' as tipo`;
      break;
  }

  const query = `SELECT ${campos} FROM ${tabla} WHERE id = ?`;
  
  db.query(query, [id], (err, results) => {
    if (err) {
      return res.status(500).json({ 
        error: `Error al obtener la información del ${tipo}` 
      });
    }

    if (results.length === 0) {
      return res.status(404).json({ 
        message: `${tipo.charAt(0).toUpperCase() + tipo.slice(1)} no encontrado` 
      });
    }

    res.status(200).json(results[0]);
  });
});

// Obtener logs del sistema
router.get("/logs", async (_req, res) => {
  const query = "SELECT * FROM inf_logs ORDER BY timestamp DESC";
  db.query(query, (err, results) => {
    if (err) {
      return res.status(500).json({ error: "Error al obtener logs" });
    }
    res.status(200).json(results);
  });
});

// Actualizar configuración de seguridad
router.post("/update-config", async (req, res) => {
  const { settingName, settingValue } = req.body;

  if (!settingName || !settingValue) {
    return res.status(400).json({ 
      message: "Nombre y valor de la configuración son requeridos." 
    });
  }

  // Validar configuraciones permitidas
  const configsPermitidas = ['MAX_ATTEMPTS', 'LOCK_TIME_MINUTES'];
  if (!configsPermitidas.includes(settingName)) {
    return res.status(400).json({ 
      message: "Configuración no válida." 
    });
  }

  // Validar que el valor sea un número positivo
  const numValue = parseInt(settingValue, 10);
  if (isNaN(numValue) || numValue <= 0) {
    return res.status(400).json({ 
      message: "El valor debe ser un número positivo." 
    });
  }

  const updateConfigSql = "UPDATE config SET setting_value = ? WHERE setting_name = ?";

  db.query(updateConfigSql, [settingValue, settingName], (err, result) => {
    if (err) {
      return res.status(500).json({ 
        message: "Error al actualizar la configuración." 
      });
    }
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ 
        message: "Configuración no encontrada." 
      });
    }
    
    return res.status(200).json({ 
      message: "Configuración actualizada exitosamente." 
    });
  });
});

// Obtener todos los pacientes
router.get("/pacientes", async (req, res) => {
  try {
    const { search = '' } = req.query;
    
    let whereClause = '';
    let queryParams = [];
    
    // Agregar filtro de búsqueda si se proporciona
    if (search) {
      whereClause = `WHERE nombre LIKE ? OR aPaterno LIKE ? OR aMaterno LIKE ? OR email LIKE ?`;
      queryParams = [`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`];
    }
    
    const query = `
      SELECT id, nombre, aPaterno, aMaterno, email, telefono, estado, fecha_creacion
      FROM pacientes 
      ${whereClause}
      ORDER BY fecha_creacion DESC
    `;
    
    db.query(query, queryParams, (err, results) => {
      if (err) {
        return res.status(500).json({ message: "Error al obtener pacientes." });
      }
      
      return res.status(200).json({
        pacientes: results,
        total: results.length
      });
    });
  } catch (error) {
    return res.status(500).json({ message: "Error en el servidor." });
  }
});

// Actualizar estado de paciente
router.put("/pacientes/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;

    if (!id || !estado) {
      return res.status(400).json({ 
        success: false,
        message: "ID y estado son requeridos." 
      });
    }

    const estadosPermitidos = ['Activo', 'Inactivo', 'Pendiente'];
    if (!estadosPermitidos.includes(estado)) {
      return res.status(400).json({ 
        success: false,
        message: `Estado no válido. Debe ser uno de: ${estadosPermitidos.join(', ')}` 
      });
    }

    const query = `
      UPDATE pacientes 
      SET estado = ?, ultima_actualizacion = CURRENT_TIMESTAMP
      WHERE id = ?
    `;
    
    db.query(query, [estado, id], (err, result) => {
      if (err) {
        return res.status(500).json({ 
          success: false,
          message: "Error al actualizar el estado en la base de datos.",
          error: err.message 
        });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ 
          success: false,
          message: "No se encontró el paciente con el ID proporcionado." 
        });
      }

      return res.status(200).json({
        success: true,
        message: "Estado actualizado correctamente",
        data: { id, estado, affectedRows: result.affectedRows }
      });
    });
  } catch (error) {
    return res.status(500).json({ 
      success: false,
      message: "Error interno del servidor.",
      error: error.message 
    });
  }
});

module.exports = router;