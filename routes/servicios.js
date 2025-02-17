const express = require('express');
const db = require('../db');
const router = express.Router();
const logger = require('../utils/logger');

router.get('/all', async (req, res) => {
    try {
        const sql = 'SELECT id, title, description, category FROM servicios';
        db.query(sql, (err, result) => {
            if (err) {
                logger.error('Error al obtener servicios: ', err);
                return res.status(500).json({ message: 'Error al obtener los servicios.' });
            }
            res.status(200).json(result);
        });
    } catch (error) {
        logger.error('Error en la ruta /api/servicios: ', error);
        res.status(500).json({ message: 'Error en el servidor.' });
    }
});

router.get('/get/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        // Obtener datos principales del servicio
        const servicioQuery = `
            SELECT id, title, description, duration, price, category 
            FROM servicios 
            WHERE id = ?
        `;

        // Obtener detalles adicionales desde `servicio_detalles`
        const detallesQuery = `
            SELECT tipo, descripcion 
            FROM servicio_detalles 
            WHERE servicio_id = ?
        `;

        db.query(servicioQuery, [id], (err, servicioResult) => {
            if (err) {
                logger.error(`Error al obtener el servicio con ID ${id}: `, err);
                return res.status(500).json({ message: 'Error al obtener el servicio.' });
            }
            if (servicioResult.length === 0) {
                return res.status(404).json({ message: 'Servicio no encontrado.' });
            }

            // Si el servicio existe, obtener los detalles
            db.query(detallesQuery, [id], (err, detallesResult) => {
                if (err) {
                    logger.error(`Error al obtener los detalles del servicio con ID ${id}: `, err);
                    return res.status(500).json({ message: 'Error al obtener los detalles del servicio.' });
                }

                // Organizar los detalles en categorías
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

                // Respuesta final con toda la información del servicio
                const servicio = {
                    ...servicioResult[0], // Datos principales del servicio
                    ...detalles // Beneficios, incluye, preparación, cuidados posteriores
                };

                res.status(200).json(servicio);
            });
        });
    } catch (error) {
        logger.error('Error en la ruta /api/servicios/get/:id: ', error);
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


module.exports = router;
