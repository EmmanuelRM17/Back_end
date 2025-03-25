// rutas/empleados.js
const express = require('express');
const db = require('../../db');
const router = express.Router();
const logger = require('../../utils/logger');
const crypto = require('crypto'); // Módulo incorporado en Node.js

// Función para generar hash de contraseña con crypto (reemplazo de bcrypt)
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

// Obtener todos los empleados
router.get('/all', async (req, res) => {
    try {
        const sql = `
    SELECT id, nombre, aPaterno, aMaterno, email, puesto, estado, 
           fecha_creacion, ultima_actualizacion, imagen, telefono
    FROM empleados
    ORDER BY nombre ASC;
  `;

        db.query(sql, (err, result) => {
            if (err) {
                logger.error('Error al obtener empleados:', err);
                return res.status(500).json({ message: 'Error al obtener los empleados.' });
            }
            res.status(200).json(result);
        });
    } catch (error) {
        logger.error('Error en la ruta /all:', error);
        res.status(500).json({ message: 'Error en el servidor.' });
    }
});

// Obtener odontólogos activos (similar a tu ruta original)
router.get('/odontologos/activos', async (req, res) => {
    try {
        const sql = `
  SELECT id, nombre, aPaterno, aMaterno, email, puesto, estado, imagen, telefono
  FROM empleados
  WHERE puesto = 'Odontólogo' AND estado = 'activo';
`;


        db.query(sql, (err, result) => {
            if (err) {
                logger.error('Error al obtener odontólogos:', err);
                return res.status(500).json({ message: 'Error al obtener los odontólogos.' });
            }
            res.status(200).json(result);
        });
    } catch (error) {
        logger.error('Error en la ruta /odontologos/activos:', error);
        res.status(500).json({ message: 'Error en el servidor.' });
    }
});

// Crear un nuevo empleado
router.post('/', async (req, res) => {
    try {
        const { nombre, aPaterno, aMaterno, email, password, puesto, estado, imagen, telefono } = req.body;

        if (!nombre || !aPaterno || !email || !password || !puesto) {
            return res.status(400).json({ success: false, message: 'Faltan campos obligatorios.' });
        }

        // Verificar si el email existe en empleados o administradores
        const checkEmailSql = `
            SELECT 'empleado' AS tipo FROM empleados WHERE email = ?
            UNION
            SELECT 'admin' AS tipo FROM administradores WHERE email = ?
        `;
        db.query(checkEmailSql, [email, email], async (err, result) => {
            if (err) {
                logger.error('Error al verificar email:', err);
                return res.status(500).json({ success: false, message: 'Error al verificar disponibilidad del email.' });
            }

            if (result.length > 0) {
                return res.status(400).json({ success: false, message: 'Este email ya está registrado en el sistema.' });
            }

            // Verificación de odontólogo activo
            if (puesto === 'Odontólogo' && estado === 'activo') {
                const checkOdontologoSql = `SELECT id FROM empleados WHERE puesto = "Odontólogo" AND estado = "activo"`;
                db.query(checkOdontologoSql, (err, result) => {
                    if (err) {
                        logger.error('Error al verificar odontólogos activos:', err);
                        return res.status(500).json({ success: false, message: 'Error al verificar odontólogos activos.' });
                    }

                    if (result.length > 0) {
                        return res.status(400).json({ success: false, message: 'Ya existe un Odontólogo activo.' });
                    }

                    procedeToSaveEmployee();
                });
            } else {
                procedeToSaveEmployee();
            }

            async function procedeToSaveEmployee() {
                try {
                    const hashedPassword = hashPassword(password);
                    const currentDate = new Date().toISOString().slice(0, 19).replace('T', ' ');

                    const insertSql = `
                        INSERT INTO empleados 
                        (nombre, aPaterno, aMaterno, email, password, puesto, estado, imagen, fecha_creacion, ultima_actualizacion, telefono)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                    `;
                    db.query(insertSql, [
                        nombre,
                        aPaterno,
                        aMaterno || null,
                        email,
                        hashedPassword,
                        puesto,
                        estado || 'activo',
                        imagen || null,
                        currentDate,
                        currentDate,
                        telefono || null
                    ], (err, result) => {
                        if (err) {
                            logger.error('Error al crear empleado:', err);
                            return res.status(500).json({ success: false, message: 'Error al guardar el empleado.' });
                        }

                        const newEmployeeId = result.insertId;
                        const selectSql = `
                            SELECT id, nombre, aPaterno, aMaterno, email, puesto, estado, imagen, fecha_creacion, ultima_actualizacion
                            FROM empleados WHERE id = ?;
                        `;
                        db.query(selectSql, [newEmployeeId], (err, result) => {
                            if (err) {
                                logger.error('Error al obtener el empleado creado:', err);
                                return res.status(201).json({ success: true, message: 'Empleado creado, pero no se pudo recuperar.' });
                            }

                            res.status(201).json(result[0]);
                        });
                    });
                } catch (error) {
                    logger.error('Error al hashear contraseña:', error);
                    return res.status(500).json({ success: false, message: 'Error al procesar la contraseña.' });
                }
            }
        });
    } catch (error) {
        logger.error('Error en la ruta POST /:', error);
        res.status(500).json({ success: false, message: 'Error en el servidor.' });
    }
});

// Actualizar un empleado existente
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, aPaterno, aMaterno, email, password, puesto, estado, imagen, telefono } = req.body;

        // Validaciones básicas
        if (!nombre || !aPaterno || !email || !puesto) {
            return res.status(400).json({
                success: false,
                message: 'Faltan campos obligatorios.'
            });
        }

        // Verificar si el email ya está en uso por otro empleado
        const checkEmailSql = 'SELECT id FROM empleados WHERE email = ? AND id != ?';
        db.query(checkEmailSql, [email, id], async (err, result) => {
            if (err) {
                logger.error('Error al verificar email:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Error al verificar disponibilidad del email.'
                });
            }

            if (result.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Este email ya está registrado por otro empleado.'
                });
            }

            // Verificar puesto actual del empleado
            const checkCurrentPositionSql = 'SELECT puesto, estado FROM empleados WHERE id = ?';
            db.query(checkCurrentPositionSql, [id], (err, result) => {
                if (err) {
                    logger.error('Error al verificar puesto actual:', err);
                    return res.status(500).json({
                        success: false,
                        message: 'Error al verificar información actual del empleado.'
                    });
                }

                if (result.length === 0) {
                    return res.status(404).json({
                        success: false,
                        message: 'Empleado no encontrado.'
                    });
                }

                const currentPosition = result[0].puesto;
                const currentStatus = result[0].estado;

                // Si está cambiando a Odontólogo activo (y no era Odontólogo activo antes)
                if (puesto === 'Odontólogo' && estado === 'activo' &&
                    (currentPosition !== 'Odontólogo' || currentStatus !== 'activo')) {

                    const checkOdontologoSql = 'SELECT id FROM empleados WHERE puesto = "Odontólogo" AND estado = "activo" AND id != ?';
                    db.query(checkOdontologoSql, [id], (err, result) => {
                        if (err) {
                            logger.error('Error al verificar odontólogos activos:', err);
                            return res.status(500).json({
                                success: false,
                                message: 'Error al verificar odontólogos activos.'
                            });
                        }

                        if (result.length > 0) {
                            return res.status(400).json({
                                success: false,
                                message: 'Ya existe un Odontólogo activo.'
                            });
                        }

                        // Si todo está bien, procedemos a actualizar
                        proceedToUpdateEmployee();
                    });
                } else {
                    // Si no es un cambio a Odontólogo activo, procedemos directamente
                    proceedToUpdateEmployee();
                }
            });

            // Función para actualizar el empleado una vez pasadas las validaciones
            async function proceedToUpdateEmployee() {
                try {
                    const currentDate = new Date().toISOString().slice(0, 19).replace('T', ' ');

                    let updateFields = [];
                    let updateValues = [];

                    // Campos básicos
                    updateFields.push('nombre = ?', 'aPaterno = ?', 'aMaterno = ?', 'email = ?', 'puesto = ?', 'estado = ?', 'ultima_actualizacion = ?', 'telefono = ?');
                    updateValues.push(nombre, aPaterno, aMaterno || null, email, puesto, estado, currentDate, telefono || null);

                    // Imagen (si se proporciona)
                    if (imagen !== undefined) {
                        updateFields.push('imagen = ?');
                        updateValues.push(imagen || null);
                    }

                    // Contraseña (solo si se proporciona una nueva)
                    if (password && password.trim() !== '') {
                        const hashedPassword = hashPassword(password);
                        updateFields.push('password = ?');
                        updateValues.push(hashedPassword);
                    }

                    // Completar el array de valores para la consulta
                    updateValues.push(id);

                    const updateSql = `
            UPDATE empleados
            SET ${updateFields.join(', ')}
            WHERE id = ?;
          `;

                    db.query(updateSql, updateValues, (err, result) => {
                        if (err) {
                            logger.error('Error al actualizar empleado:', err);
                            return res.status(500).json({
                                success: false,
                                message: 'Error al actualizar el empleado.'
                            });
                        }

                        if (result.affectedRows === 0) {
                            return res.status(404).json({
                                success: false,
                                message: 'Empleado no encontrado.'
                            });
                        }

                        // Obtener el empleado actualizado
                        const selectSql = `
              SELECT id, nombre, aPaterno, aMaterno, email, puesto, estado, imagen, fecha_creacion, ultima_actualizacion
              FROM empleados
              WHERE id = ?;
            `;

                        db.query(selectSql, [id], (err, result) => {
                            if (err) {
                                logger.error('Error al obtener el empleado actualizado:', err);
                                return res.status(200).json({
                                    success: true,
                                    message: 'Empleado actualizado exitosamente.'
                                });
                            }

                            res.status(200).json(result[0]);
                        });
                    });
                } catch (error) {
                    logger.error('Error al hashear contraseña:', error);
                    return res.status(500).json({
                        success: false,
                        message: 'Error al procesar la contraseña.'
                    });
                }
            }
        });
    } catch (error) {
        logger.error(`Error en la ruta PUT /${req.params.id}:`, error);
        res.status(500).json({
            success: false,
            message: 'Error en el servidor.'
        });
    }
});

// Cambiar el estado de un empleado (activar/desactivar)
router.put('/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { estado } = req.body;

        if (!estado || (estado !== 'activo' && estado !== 'inactivo')) {
            return res.status(400).json({
                success: false,
                message: 'Estado inválido. Debe ser "activo" o "inactivo".'
            });
        }

        // Si estamos activando y el puesto es Odontólogo, verificar que no haya otro Odontólogo activo
        if (estado === 'activo') {
            const checkEmployeeSql = 'SELECT puesto FROM empleados WHERE id = ?';
            db.query(checkEmployeeSql, [id], (err, result) => {
                if (err) {
                    logger.error('Error al verificar puesto del empleado:', err);
                    return res.status(500).json({
                        success: false,
                        message: 'Error al verificar información del empleado.'
                    });
                }

                if (result.length === 0) {
                    return res.status(404).json({
                        success: false,
                        message: 'Empleado no encontrado.'
                    });
                }

                const puesto = result[0].puesto;

                if (puesto === 'Odontólogo') {
                    const checkOdontologoSql = 'SELECT id FROM empleados WHERE puesto = "Odontólogo" AND estado = "activo" AND id != ?';
                    db.query(checkOdontologoSql, [id], (err, result) => {
                        if (err) {
                            logger.error('Error al verificar odontólogos activos:', err);
                            return res.status(500).json({
                                success: false,
                                message: 'Error al verificar odontólogos activos.'
                            });
                        }

                        if (result.length > 0) {
                            return res.status(400).json({
                                success: false,
                                message: 'Ya existe un Odontólogo activo.'
                            });
                        }

                        // Si todo está bien, procedemos a actualizar estado
                        updateEmployeeStatus();
                    });
                } else {
                    // Si no es odontólogo, procedemos directamente
                    updateEmployeeStatus();
                }
            });
        } else {
            // Si estamos desactivando, podemos proceder directamente
            updateEmployeeStatus();
        }

        function updateEmployeeStatus() {
            const currentDate = new Date().toISOString().slice(0, 19).replace('T', ' ');

            const updateSql = `
        UPDATE empleados
        SET estado = ?, ultima_actualizacion = ?
        WHERE id = ?;
      `;

            db.query(updateSql, [estado, currentDate, id], (err, result) => {
                if (err) {
                    logger.error('Error al actualizar estado del empleado:', err);
                    return res.status(500).json({
                        success: false,
                        message: 'Error al actualizar el estado del empleado.'
                    });
                }

                if (result.affectedRows === 0) {
                    return res.status(404).json({
                        success: false,
                        message: 'Empleado no encontrado.'
                    });
                }

                res.status(200).json({
                    success: true,
                    message: `Empleado ${estado === 'activo' ? 'activado' : 'desactivado'} exitosamente.`
                });
            });
        }
    } catch (error) {
        logger.error(`Error en la ruta PUT /${req.params.id}/status:`, error);
        res.status(500).json({
            success: false,
            message: 'Error en el servidor.'
        });
    }
});

module.exports = router;