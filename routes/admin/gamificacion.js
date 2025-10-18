const express = require("express");
const router = express.Router();
const db = require("../../db");

// ==================== RECOMPENSAS ====================

// Obtener todas las recompensas
router.get("/recompensas", (req, res) => {
  const query = `
    SELECT * FROM gamificacion_recompensa 
    ORDER BY orden ASC, puntos_requeridos ASC
  `;
  
  db.query(query, (err, results) => {
    if (err) {
      console.error("Error al obtener recompensas:", err);
      return res.status(500).json({ error: "Error al obtener recompensas" });
    }
    res.status(200).json(results);
  });
});

// Obtener recompensas activas
router.get("/recompensas/activas", (req, res) => {
  const query = `
    SELECT * FROM gamificacion_recompensa 
    WHERE estado = 1 
    ORDER BY orden ASC, puntos_requeridos ASC
  `;
  
  db.query(query, (err, results) => {
    if (err) {
      console.error("Error al obtener recompensas activas:", err);
      return res.status(500).json({ error: "Error al obtener recompensas" });
    }
    res.status(200).json(results);
  });
});

// Crear recompensa
router.post("/recompensas", (req, res) => {
  const { nombre, descripcion, tipo, puntos_requeridos, icono, premio, orden } = req.body;
  
  if (!nombre || !tipo || !puntos_requeridos) {
    return res.status(400).json({ error: "Faltan datos requeridos" });
  }
  
  const query = `
    INSERT INTO gamificacion_recompensa 
    (nombre, descripcion, tipo, puntos_requeridos, icono, premio, orden, estado) 
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `;
  
  db.query(query, [nombre, descripcion, tipo, puntos_requeridos, icono, premio, orden || 0], (err, result) => {
    if (err) {
      console.error("Error al crear recompensa:", err);
      return res.status(500).json({ error: "Error al crear recompensa" });
    }
    res.status(201).json({ message: "Recompensa creada", id: result.insertId });
  });
});

// Editar recompensa
router.put("/recompensas/:id", (req, res) => {
  const { id } = req.params;
  const { nombre, descripcion, tipo, puntos_requeridos, icono, premio, orden, estado } = req.body;
  
  const query = `
    UPDATE gamificacion_recompensa 
    SET nombre = ?, descripcion = ?, tipo = ?, puntos_requeridos = ?, 
        icono = ?, premio = ?, orden = ?, estado = ?
    WHERE id = ?
  `;
  
  db.query(query, [nombre, descripcion, tipo, puntos_requeridos, icono, premio, orden, estado, id], (err, result) => {
    if (err) {
      console.error("Error al editar recompensa:", err);
      return res.status(500).json({ error: "Error al editar recompensa" });
    }
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Recompensa no encontrada" });
    }
    
    res.status(200).json({ message: "Recompensa actualizada" });
  });
});

// Eliminar recompensa
router.delete("/recompensas/:id", (req, res) => {
  const { id } = req.params;
  
  const query = "DELETE FROM gamificacion_recompensa WHERE id = ?";
  
  db.query(query, [id], (err, result) => {
    if (err) {
      console.error("Error al eliminar recompensa:", err);
      return res.status(500).json({ error: "Error al eliminar recompensa" });
    }
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Recompensa no encontrada" });
    }
    
    res.status(200).json({ message: "Recompensa eliminada" });
  });
});

// ==================== SERVICIOS GAMIFICACIÓN ====================

// Obtener todos los servicios con puntos asignados
router.get("/servicios-gamificacion", (req, res) => {
  const query = `
    SELECT 
      gs.id,
      gs.id_servicio,
      gs.puntos,
      gs.estado,
      gs.fecha_creacion,
      s.title as nombre_servicio,
      s.description as descripcion_servicio,
      s.price as precio_servicio
    FROM gamificacion_servicios gs
    INNER JOIN servicios s ON gs.id_servicio = s.id
    ORDER BY gs.estado DESC, s.title ASC
  `;
  
  db.query(query, (err, results) => {
    if (err) {
      console.error("Error al obtener servicios gamificación:", err);
      return res.status(500).json({ error: "Error al obtener servicios" });
    }
    res.status(200).json(results);
  });
});

// Obtener solo servicios activos en gamificación
router.get("/servicios-gamificacion/activos", (req, res) => {
  const query = `
    SELECT 
      gs.id,
      gs.id_servicio,
      gs.puntos,
      gs.estado,
      s.title as nombre_servicio,
      s.description as descripcion_servicio
    FROM gamificacion_servicios gs
    INNER JOIN servicios s ON gs.id_servicio = s.id
    WHERE gs.estado = 1
    ORDER BY s.title ASC
  `;
  
  db.query(query, (err, results) => {
    if (err) {
      console.error("Error al obtener servicios activos:", err);
      return res.status(500).json({ error: "Error al obtener servicios" });
    }
    res.status(200).json(results);
  });
});

// Obtener servicios disponibles (sin puntos asignados)
router.get("/servicios/disponibles", (req, res) => {
  const query = `
    SELECT 
      s.id,
      s.title as nombre,
      s.description as descripcion,
      s.price as precio
    FROM servicios s
    WHERE s.id NOT IN (SELECT id_servicio FROM gamificacion_servicios)
    ORDER BY s.title ASC
  `;
  
  db.query(query, (err, results) => {
    if (err) {
      console.error("Error al obtener servicios disponibles:", err);
      return res.status(500).json({ error: "Error al obtener servicios" });
    }
    res.status(200).json(results);
  });
});

// Asignar puntos a un servicio (crear asociación)
router.post("/servicios-gamificacion", (req, res) => {
  const { id_servicio, puntos } = req.body;
  
  if (!id_servicio || !puntos) {
    return res.status(400).json({ error: "Faltan datos requeridos" });
  }
  
  if (puntos <= 0) {
    return res.status(400).json({ error: "Los puntos deben ser mayores a 0" });
  }
  
  // Verificar que el servicio existe
  const queryCheckServicio = "SELECT id FROM servicios WHERE id = ?";
  
  db.query(queryCheckServicio, [id_servicio], (err, results) => {
    if (err) {
      console.error("Error al verificar servicio:", err);
      return res.status(500).json({ error: "Error al verificar servicio" });
    }
    
    if (results.length === 0) {
      return res.status(404).json({ error: "Servicio no encontrado" });
    }
    
    // Verificar que no esté ya asignado
    const queryCheckAsignado = "SELECT id FROM gamificacion_servicios WHERE id_servicio = ?";
    
    db.query(queryCheckAsignado, [id_servicio], (err, results) => {
      if (err) {
        console.error("Error al verificar asignación:", err);
        return res.status(500).json({ error: "Error al verificar asignación" });
      }
      
      if (results.length > 0) {
        return res.status(400).json({ error: "Este servicio ya tiene puntos asignados" });
      }
      
      // Insertar en gamificacion_servicios
      const queryInsert = `
        INSERT INTO gamificacion_servicios (id_servicio, puntos, estado) 
        VALUES (?, ?, 1)
      `;
      
      db.query(queryInsert, [id_servicio, puntos], (err, result) => {
        if (err) {
          console.error("Error al asignar puntos:", err);
          return res.status(500).json({ error: "Error al asignar puntos" });
        }
        res.status(201).json({ 
          message: "Puntos asignados correctamente", 
          id: result.insertId 
        });
      });
    });
  });
});

// Editar puntos de un servicio
router.put("/servicios-gamificacion/:id", (req, res) => {
  const { id } = req.params;
  const { puntos, estado } = req.body;
  
  if (!puntos && estado === undefined) {
    return res.status(400).json({ error: "Debe proporcionar puntos o estado" });
  }
  
  if (puntos && puntos <= 0) {
    return res.status(400).json({ error: "Los puntos deben ser mayores a 0" });
  }
  
  const query = `
    UPDATE gamificacion_servicios 
    SET puntos = ?, estado = ?
    WHERE id = ?
  `;
  
  db.query(query, [puntos, estado, id], (err, result) => {
    if (err) {
      console.error("Error al editar servicio:", err);
      return res.status(500).json({ error: "Error al editar servicio" });
    }
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Servicio no encontrado" });
    }
    
    res.status(200).json({ message: "Servicio actualizado correctamente" });
  });
});

// Eliminar asociación de servicio (quitar de gamificación)
router.delete("/servicios-gamificacion/:id", (req, res) => {
  const { id } = req.params;
  
  const query = "DELETE FROM gamificacion_servicios WHERE id = ?";
  
  db.query(query, [id], (err, result) => {
    if (err) {
      console.error("Error al eliminar servicio:", err);
      return res.status(500).json({ error: "Error al eliminar servicio" });
    }
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Servicio no encontrado" });
    }
    
    res.status(200).json({ message: "Servicio eliminado de gamificación" });
  });
});

// ==================== PACIENTES GAMIFICACIÓN ====================

// Obtener todos los pacientes con sus puntos
router.get("/pacientes-gamificacion", (req, res) => {
  const query = `
    SELECT 
      gp.id,
      gp.id_paciente,
      gp.puntos_disponibles,
      gp.puntos_totales,
      gp.descuento,
      gp.nivel,
      gp.fecha_actualizacion,
      gp.estado,
      CONCAT(p.nombre, ' ', p.aPaterno, ' ', p.aMaterno) as nombre_completo,
      p.email,
      p.telefono
    FROM gamificacion_paciente gp
    INNER JOIN pacientes p ON gp.id_paciente = p.id
    WHERE gp.estado = 1
    ORDER BY gp.puntos_disponibles DESC
  `;
  
  db.query(query, (err, results) => {
    if (err) {
      console.error("Error al obtener pacientes:", err);
      return res.status(500).json({ error: "Error al obtener pacientes" });
    }
    res.status(200).json(results);
  });
});

// ==================== PUNTOS PACIENTE ====================

// Obtener saldo del paciente
router.get("/paciente/:id", (req, res) => {
  const { id } = req.params;
  
  const query = `
    SELECT * FROM gamificacion_paciente 
    WHERE id_paciente = ? AND estado = 1
  `;
  
  db.query(query, [id], (err, results) => {
    if (err) {
      console.error("Error al obtener puntos:", err);
      return res.status(500).json({ error: "Error al obtener puntos" });
    }
    
    if (results.length === 0) {
      return res.status(404).json({ error: "Paciente no encontrado en gamificación" });
    }
    
    res.status(200).json(results[0]);
  });
});

// Inicializar gamificación para paciente
router.post("/paciente/inicializar", (req, res) => {
  const { id_paciente } = req.body;
  
  if (!id_paciente) {
    return res.status(400).json({ error: "ID de paciente requerido" });
  }
  
  const queryCheck = "SELECT id FROM gamificacion_paciente WHERE id_paciente = ?";
  
  db.query(queryCheck, [id_paciente], (err, results) => {
    if (err) {
      console.error("Error al verificar paciente:", err);
      return res.status(500).json({ error: "Error al verificar paciente" });
    }
    
    if (results.length > 0) {
      return res.status(400).json({ error: "Paciente ya tiene gamificación activa" });
    }
    
    const queryInsert = `
      INSERT INTO gamificacion_paciente 
      (id_paciente, puntos_disponibles, puntos_totales, descuento, nivel, estado) 
      VALUES (?, 0, 0, 0, 1, 1)
    `;
    
    db.query(queryInsert, [id_paciente], (err, result) => {
      if (err) {
        console.error("Error al inicializar gamificación:", err);
        return res.status(500).json({ error: "Error al inicializar gamificación" });
      }
      res.status(201).json({ message: "Gamificación inicializada", id: result.insertId });
    });
  });
});

// Asignar puntos a paciente
router.post("/paciente/asignar", (req, res) => {
  const { id_paciente, puntos, concepto } = req.body;
  
  if (!id_paciente || !puntos || !concepto) {
    return res.status(400).json({ error: "Faltan datos requeridos" });
  }
  
  if (puntos <= 0) {
    return res.status(400).json({ error: "Los puntos deben ser mayores a 0" });
  }
  
  // Verificar si existe el registro
  const queryCheck = "SELECT id FROM gamificacion_paciente WHERE id_paciente = ?";
  
  db.query(queryCheck, [id_paciente], (err, results) => {
    if (err) {
      console.error("Error al verificar paciente:", err);
      return res.status(500).json({ error: "Error al verificar paciente" });
    }
    
    if (results.length === 0) {
      return res.status(404).json({ error: "Paciente no tiene gamificación activa" });
    }
    
    // Actualizar puntos
    const queryUpdate = `
      UPDATE gamificacion_paciente 
      SET puntos_disponibles = puntos_disponibles + ?,
          puntos_totales = puntos_totales + ?,
          nivel = FLOOR((puntos_totales + ?) / 100) + 1,
          fecha_actualizacion = NOW()
      WHERE id_paciente = ?
    `;
    
    db.query(queryUpdate, [puntos, puntos, puntos, id_paciente], (err) => {
      if (err) {
        console.error("Error al asignar puntos:", err);
        return res.status(500).json({ error: "Error al asignar puntos" });
      }
      
      // Registrar en historial
      const queryHistorial = `
        INSERT INTO historial_puntos 
        (id_paciente, puntos, concepto, tipo) 
        VALUES (?, ?, ?, 'asignado')
      `;
      
      db.query(queryHistorial, [id_paciente, puntos, concepto], (err) => {
        if (err) {
          console.error("Error al registrar historial:", err);
        }
        res.status(200).json({ message: "Puntos asignados correctamente" });
      });
    });
  });
});

// Descontar puntos manualmente
router.post("/paciente/descontar", (req, res) => {
  const { id_paciente, puntos, concepto } = req.body;
  
  if (!id_paciente || !puntos || !concepto) {
    return res.status(400).json({ error: "Faltan datos requeridos" });
  }
  
  if (puntos <= 0) {
    return res.status(400).json({ error: "Los puntos deben ser mayores a 0" });
  }
  
  // Verificar saldo disponible
  const queryCheck = "SELECT puntos_disponibles FROM gamificacion_paciente WHERE id_paciente = ?";
  
  db.query(queryCheck, [id_paciente], (err, results) => {
    if (err) {
      console.error("Error al verificar paciente:", err);
      return res.status(500).json({ error: "Error al verificar paciente" });
    }
    
    if (results.length === 0) {
      return res.status(404).json({ error: "Paciente no encontrado" });
    }
    
    if (results[0].puntos_disponibles < puntos) {
      return res.status(400).json({ error: "Puntos insuficientes" });
    }
    
    // Descontar puntos
    const queryUpdate = `
      UPDATE gamificacion_paciente 
      SET puntos_disponibles = puntos_disponibles - ?,
          fecha_actualizacion = NOW()
      WHERE id_paciente = ?
    `;
    
    db.query(queryUpdate, [puntos, id_paciente], (err) => {
      if (err) {
        console.error("Error al descontar puntos:", err);
        return res.status(500).json({ error: "Error al descontar puntos" });
      }
      
      // Registrar en historial
      const queryHistorial = `
        INSERT INTO historial_puntos 
        (id_paciente, puntos, concepto, tipo) 
        VALUES (?, ?, ?, 'descontado')
      `;
      
      db.query(queryHistorial, [id_paciente, -puntos, concepto], (err) => {
        if (err) {
          console.error("Error al registrar historial:", err);
        }
        res.status(200).json({ message: "Puntos descontados correctamente" });
      });
    });
  });
});

// ==================== CANJEAR RECOMPENSA ====================

// Generar código único de canje
function generarCodigoCanje() {
  const timestamp = Date.now().toString();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `ODP${timestamp.slice(-4)}${random}`;
}

// Canjear recompensa
router.post("/canjear", (req, res) => {
  const { id_paciente, id_recompensa } = req.body;
  
  if (!id_paciente || !id_recompensa) {
    return res.status(400).json({ error: "Faltan datos requeridos" });
  }
  
  // Obtener datos del paciente y recompensa
  const queryPaciente = "SELECT puntos_disponibles FROM gamificacion_paciente WHERE id_paciente = ?";
  const queryRecompensa = "SELECT puntos_requeridos, nombre FROM gamificacion_recompensa WHERE id = ? AND estado = 1";
  
  db.query(queryPaciente, [id_paciente], (err, resPaciente) => {
    if (err) {
      console.error("Error al verificar paciente:", err);
      return res.status(500).json({ error: "Error al verificar paciente" });
    }
    
    if (resPaciente.length === 0) {
      return res.status(404).json({ error: "Paciente no encontrado" });
    }
    
    db.query(queryRecompensa, [id_recompensa], (err, resRecompensa) => {
      if (err) {
        console.error("Error al verificar recompensa:", err);
        return res.status(500).json({ error: "Error al verificar recompensa" });
      }
      
      if (resRecompensa.length === 0) {
        return res.status(404).json({ error: "Recompensa no disponible" });
      }
      
      const puntosDisponibles = resPaciente[0].puntos_disponibles;
      const puntosRequeridos = resRecompensa[0].puntos_requeridos;
      const nombreRecompensa = resRecompensa[0].nombre;
      
      if (puntosDisponibles < puntosRequeridos) {
        return res.status(400).json({ error: "Puntos insuficientes" });
      }
      
      const codigoCanje = generarCodigoCanje();
      
      // Descontar puntos
      const queryUpdate = `
        UPDATE gamificacion_paciente 
        SET puntos_disponibles = puntos_disponibles - ?,
            fecha_actualizacion = NOW()
        WHERE id_paciente = ?
      `;
      
      db.query(queryUpdate, [puntosRequeridos, id_paciente], (err) => {
        if (err) {
          console.error("Error al descontar puntos:", err);
          return res.status(500).json({ error: "Error al procesar canje" });
        }
        
        // Registrar en historial de puntos
        const queryHistorial = `
          INSERT INTO historial_puntos 
          (id_paciente, puntos, concepto, tipo) 
          VALUES (?, ?, ?, 'descontado')
        `;
        
        const concepto = `Canje: ${nombreRecompensa}`;
        
        db.query(queryHistorial, [id_paciente, -puntosRequeridos, concepto], (err) => {
          if (err) {
            console.error("Error al registrar historial puntos:", err);
          }
        });
        
        // Registrar en historial de canjeos
        const queryCanje = `
          INSERT INTO historial_canjeos 
          (id_paciente, id_recompensa, puntos_canjeados, codigo_canje, estado) 
          VALUES (?, ?, ?, ?, 'activo')
        `;
        
        db.query(queryCanje, [id_paciente, id_recompensa, puntosRequeridos, codigoCanje], (err, result) => {
          if (err) {
            console.error("Error al registrar canje:", err);
            return res.status(500).json({ error: "Error al registrar canje" });
          }
          
          res.status(200).json({ 
            message: "Canje exitoso", 
            codigo_canje: codigoCanje,
            id_canje: result.insertId
          });
        });
      });
    });
  });
});

// ==================== HISTORIAL ====================

// Obtener historial de puntos de un paciente
router.get("/historial-puntos/:id_paciente", (req, res) => {
  const { id_paciente } = req.params;
  const { limite } = req.query;
  
  let query = `
    SELECT * FROM historial_puntos 
    WHERE id_paciente = ? 
    ORDER BY fecha DESC
  `;
  
  if (limite) {
    query += ` LIMIT ${parseInt(limite)}`;
  }
  
  db.query(query, [id_paciente], (err, results) => {
    if (err) {
      console.error("Error al obtener historial:", err);
      return res.status(500).json({ error: "Error al obtener historial" });
    }
    res.status(200).json(results);
  });
});

// Obtener historial de canjeos de un paciente
router.get("/historial-canjeos/:id_paciente", (req, res) => {
  const { id_paciente } = req.params;
  
  const query = `
    SELECT hc.*, gr.nombre as nombre_recompensa, gr.descripcion, gr.icono
    FROM historial_canjeos hc
    JOIN gamificacion_recompensa gr ON hc.id_recompensa = gr.id
    WHERE hc.id_paciente = ?
    ORDER BY hc.fecha_canje DESC
  `;
  
  db.query(query, [id_paciente], (err, results) => {
    if (err) {
      console.error("Error al obtener historial de canjeos:", err);
      return res.status(500).json({ error: "Error al obtener historial" });
    }
    res.status(200).json(results);
  });
});

// Verificar código de canje
router.get("/verificar-canje/:codigo", (req, res) => {
  const { codigo } = req.params;
  
  const query = `
    SELECT hc.*, 
           CONCAT(p.nombre, ' ', p.aPaterno, ' ', p.aMaterno) as nombre_paciente,
           p.email,
           gr.nombre as nombre_recompensa,
           gr.descripcion,
           gr.premio
    FROM historial_canjeos hc
    JOIN pacientes p ON hc.id_paciente = p.id
    JOIN gamificacion_recompensa gr ON hc.id_recompensa = gr.id
    WHERE hc.codigo_canje = ?
  `;
  
  db.query(query, [codigo], (err, results) => {
    if (err) {
      console.error("Error al verificar código:", err);
      return res.status(500).json({ error: "Error al verificar código" });
    }
    
    if (results.length === 0) {
      return res.status(404).json({ error: "Código no encontrado" });
    }
    
    res.status(200).json(results[0]);
  });
});

// Marcar canje como usado
router.put("/usar-canje/:codigo", (req, res) => {
  const { codigo } = req.params;
  
  const queryCheck = "SELECT estado FROM historial_canjeos WHERE codigo_canje = ?";
  
  db.query(queryCheck, [codigo], (err, results) => {
    if (err) {
      console.error("Error al verificar canje:", err);
      return res.status(500).json({ error: "Error al verificar canje" });
    }
    
    if (results.length === 0) {
      return res.status(404).json({ error: "Código no encontrado" });
    }
    
    if (results[0].estado === 'usado') {
      return res.status(400).json({ error: "Este código ya fue utilizado" });
    }
    
    if (results[0].estado === 'expirado') {
      return res.status(400).json({ error: "Este código está expirado" });
    }
    
    const queryUpdate = "UPDATE historial_canjeos SET estado = 'usado' WHERE codigo_canje = ?";
    
    db.query(queryUpdate, [codigo], (err) => {
      if (err) {
        console.error("Error al marcar como usado:", err);
        return res.status(500).json({ error: "Error al actualizar canje" });
      }
      res.status(200).json({ message: "Canje marcado como usado" });
    });
  });
});

module.exports = router;