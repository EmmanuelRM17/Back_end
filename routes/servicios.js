const express = require('express');
const db = require('../db');
const router = express.Router();
const logger = require('../utils/logger');

router.get('/all', async (req, res) => {
    try {
        const sql = 'SELECT id, title, description, category, price, duration FROM servicios';
        db.query(sql, (err, result) => {
            if (err) {
                logger.error('Error al obtener servicios: ', err);
                return res.status(500).json({ message: 'Error al obtener los servicios.' });
            }
            res.status(200).json(result);
        });
    } catch (error) {
        logger.error('Error en la ruta /api/servicios/all: ', error);
        res.status(500).json({ message: 'Error en el servidor.' });
    }
});

//obtener servicio por el id
router.get('/get/:id', async (req, res) => {
    const { id } = req.params;
    
    console.log("🔍 Recibiendo solicitud para ID:", id); // 👀 Verifica si llega correctamente

    if (!id) {
        console.error("❌ ID no recibido en la solicitud.");
        return res.status(400).json({ message: "ID de servicio no proporcionado" });
    }

    try {
        const servicioQuery = `
            SELECT id, title, description, duration, price, category 
            FROM servicios 
            WHERE id = ?
        `;

        db.query(servicioQuery, [id], (err, servicioResult) => {
            if (err) {
                console.error(`❌ Error en la consulta a la base de datos para ID ${id}:`, err);
                return res.status(500).json({ message: 'Error al obtener el servicio.' });
            }

            console.log("🔍 Resultado de la consulta:", servicioResult); // 👀 Verifica si encontró algo

            if (servicioResult.length === 0) {
                console.warn(`⚠️ No se encontró el servicio con ID ${id} en la base de datos.`);
                return res.status(404).json({ message: 'Servicio no encontrado.' });
            }

            const detallesQuery = `
                SELECT tipo, descripcion 
                FROM servicio_detalles 
                WHERE servicio_id = ?
            `;

            db.query(detallesQuery, [id], (err, detallesResult) => {
                if (err) {
                    console.error(`❌ Error en la consulta de detalles para ID ${id}:`, err);
                    return res.status(500).json({ message: 'Error al obtener los detalles del servicio.' });
                }

                console.log("🔍 Detalles obtenidos:", detallesResult);

                const detalles = {
                    benefits: [],
                    includes: [],
                    preparation: [],
                    aftercare: []
                };

                detallesResult.forEach(detalle => {
                    switch (detalle.tipo) {
                        case 'beneficio':
                            detalles.benefits.push(detalle.descripcion);
                            break;
                        case 'incluye':
                            detalles.includes.push(detalle.descripcion);
                            break;
                        case 'preparacion':
                            detalles.preparation.push(detalle.descripcion);
                            break;
                        case 'cuidado':
                            detalles.aftercare.push(detalle.descripcion);
                            break;
                    }
                });

                const servicio = {
                    ...servicioResult[0],
                    ...detalles
                };

                res.status(200).json(servicio);
            });
        });
    } catch (error) {
        console.error('❌ Error en la ruta /api/servicios/get/:id: ', error);
        res.status(500).json({ message: 'Error en el servidor.' });
    }
});


router.get('/detalles', async (req, res) => {
    try {
        const sql = 'SELECT servicio_id, tipo, descripcion FROM servicio_detalles';
        
        db.query(sql, (err, result) => {
            if (err) {
                logger.error('Error al obtener detalles de servicios: ', err);
                return res.status(500).json({ message: 'Error al obtener los detalles de los servicios.' });
            }
            res.status(200).json(result);
        });
    } catch (error) {
        logger.error('Error en la ruta /api/servicios/detalles: ', error);
        res.status(500).json({ message: 'Error en el servidor.' });
    }
});

// Endpoint para editar un servicio
router.put('/update/:id', async (req, res) => {
    const { id } = req.params;
    const { title, description, duration, price, category, benefits, includes, preparation, aftercare } = req.body;
  
    // Actualizar datos principales en la tabla "servicios"
    const updateQuery = 'UPDATE servicios SET title = ?, description = ?, duration = ?, price = ?, category = ? WHERE id = ?';
    db.query(updateQuery, [title, description, duration, price, category, id], (err, updateResult) => {
      if (err) {
        logger.error(`Error al actualizar servicio con ID ${id}: `, err);
        return res.status(500).json({ message: 'Error al actualizar el servicio.' });
      }
      // Eliminar detalles actuales
      const deleteDetailsQuery = 'DELETE FROM servicio_detalles WHERE servicio_id = ?';
      db.query(deleteDetailsQuery, [id], (err, deleteResult) => {
        if (err) {
          logger.error(`Error al eliminar detalles del servicio con ID ${id}: `, err);
          return res.status(500).json({ message: 'Error al actualizar los detalles del servicio.' });
        }
  
        // Preparar nuevos detalles a insertar
        const detailsToInsert = [];
        if (Array.isArray(benefits)) {
          benefits.forEach(b => { if (b.trim()) detailsToInsert.push(['beneficio', b, id]); });
        }
        if (Array.isArray(includes)) {
          includes.forEach(i => { if (i.trim()) detailsToInsert.push(['incluye', i, id]); });
        }
        if (Array.isArray(preparation)) {
          preparation.forEach(p => { if (p.trim()) detailsToInsert.push(['preparacion', p, id]); });
        }
        if (Array.isArray(aftercare)) {
          aftercare.forEach(a => { if (a.trim()) detailsToInsert.push(['cuidado', a, id]); });
        }
  
        if (detailsToInsert.length === 0) {
          return res.status(200).json({ message: 'Servicio actualizado correctamente.' });
        }
  
        const insertQuery = 'INSERT INTO servicio_detalles (tipo, descripcion, servicio_id) VALUES ?';
        db.query(insertQuery, [detailsToInsert], (err, insertResult) => {
          if (err) {
            logger.error(`Error al insertar detalles del servicio con ID ${id}: `, err);
            return res.status(500).json({ message: 'Error al actualizar los detalles del servicio.' });
          }
          res.status(200).json({ message: 'Servicio actualizado correctamente.' });
        });
      });
    });
  });
  
  // Endpoint para eliminar un servicio
  router.delete('/delete/:id', async (req, res) => {
    const { id } = req.params;
  
    // Primero eliminar los detalles asociados
    const deleteDetailsQuery = 'DELETE FROM servicio_detalles WHERE servicio_id = ?';
    db.query(deleteDetailsQuery, [id], (err, detailsResult) => {
      if (err) {
        logger.error(`Error al eliminar detalles del servicio con ID ${id}: `, err);
        return res.status(500).json({ message: 'Error al eliminar los detalles del servicio.' });
      }
      // Luego eliminar el servicio principal
      const deleteServiceQuery = 'DELETE FROM servicios WHERE id = ?';
      db.query(deleteServiceQuery, [id], (err, serviceResult) => {
        if (err) {
          logger.error(`Error al eliminar el servicio con ID ${id}: `, err);
          return res.status(500).json({ message: 'Error al eliminar el servicio.' });
        }
        res.status(200).json({ message: 'Servicio eliminado correctamente.' });
      });
    });
  });
  

module.exports = router;
