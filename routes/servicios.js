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

// Obtener todas las categorías de los servicios (sin duplicados)
router.get('/categorias', async (req, res) => {
  try {
      const sql = `SHOW COLUMNS FROM servicios LIKE 'category'`; // Obtiene la definición del ENUM
      db.query(sql, (err, result) => {
          if (err) {
              logger.error('Error al obtener categorías ENUM: ', err);
              return res.status(500).json({ message: 'Error al obtener las categorías.' });
          }

          const enumValues = result[0].Type.match(/'([^']+)'/g).map(val => val.replace(/'/g, ''));
          res.status(200).json(enumValues);
      });
  } catch (error) {
      logger.error('Error en la ruta /api/servicios/categorias: ', error);
      res.status(500).json({ message: 'Error en el servidor.' });
  }
});

router.post('/create', async (req, res) => {
  let { title, description, category, duration, price, benefits, includes, preparation, aftercare } = req.body;

  // Expresión regular para evitar caracteres especiales peligrosos (excepto tildes y comas)
  const regexValidText = /^[a-zA-ZÁÉÍÓÚáéíóúñÑ0-9.,\s-]+$/;

  // Validaciones generales
  if (!title || !description || !category || !duration || !price) {
      return res.status(400).json({ message: 'Todos los campos son obligatorios.' });
  }
  if (!regexValidText.test(title) || !regexValidText.test(description) || !regexValidText.test(category)) {
      return res.status(400).json({ message: 'Los campos no pueden contener caracteres especiales.' });
  }
  if (isNaN(price) || price <= 0) {
      return res.status(400).json({ message: 'El precio debe ser un número mayor a 0.' });
  }
  if (!/^\d+-\d+ minutos$/.test(duration)) {
      return res.status(400).json({ message: 'La duración debe estar en formato "X-Y minutos".' });
  }

  try {
      // Verificar si la categoría existe en la BDD
      const categoryCheckQuery = `SHOW COLUMNS FROM servicios LIKE 'category'`;
      db.query(categoryCheckQuery, (err, result) => {
          if (err) {
              console.error('❌ Error al verificar la categoría:', err);
              return res.status(500).json({ message: 'Error al validar la categoría.' });
          }

          const enumValues = result[0].Type.match(/'([^']+)'/g).map(val => val.replace(/'/g, ''));
          if (!enumValues.includes(category)) {
              return res.status(400).json({ message: `La categoría '${category}' no es válida.` });
          }

          // Insertar el servicio en la tabla "servicios"
          const insertServiceQuery = 'INSERT INTO servicios (title, description, category, duration, price) VALUES (?, ?, ?, ?, ?)';
          db.query(insertServiceQuery, [title, description, category, duration, price], (err, result) => {
              if (err) {
                  console.error('❌ Error al insertar servicio:', err);
                  return res.status(500).json({ message: 'Error al registrar el servicio.' });
              }

              const servicio_id = result.insertId; // Obtener ID del servicio recién creado

              // Validar arrays antes de insertar detalles
              const detallesValues = [];

              const validateArray = (arr, tipo) => {
                  if (Array.isArray(arr)) {
                      arr.forEach(item => {
                          if (typeof item === 'string' && item.trim() !== '') {
                              detallesValues.push([servicio_id, tipo, item.trim()]);
                          }
                      });
                  }
              };

              validateArray(benefits, 'beneficio');
              validateArray(includes, 'incluye');
              validateArray(preparation, 'preparacion');
              validateArray(aftercare, 'cuidado');

              if (detallesValues.length === 0) {
                  return res.status(201).json({ message: 'Servicio creado correctamente.', servicio_id });
              }

              //  Insertar detalles en "servicio_detalles"
              const insertDetailsQuery = 'INSERT INTO servicio_detalles (servicio_id, tipo, descripcion) VALUES ?';
              db.query(insertDetailsQuery, [detallesValues], (err) => {
                  if (err) {
                      console.error('❌ Error al insertar detalles:', err);
                      return res.status(500).json({ message: 'Error al registrar los detalles del servicio.' });
                  }

                  res.status(201).json({ message: 'Servicio y detalles creados correctamente.', servicio_id });
              });
          });
      });
  } catch (error) {
      console.error('❌ Error en el servidor:', error);
      res.status(500).json({ message: 'Error en el servidor.' });
  }
});


module.exports = router;
