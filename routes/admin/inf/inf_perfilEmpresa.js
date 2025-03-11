const express = require('express');
const db = require('../../../db'); 
const multer = require('multer');
const router = express.Router();

/**
 * Configuración de multer para manejar la subida de archivos en memoria
 * Permite subir imágenes de hasta 10MB y restringe el tipo de archivo
 */
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 1024 * 1024 * 10 }, // Límite de 10MB para archivos
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg' || file.mimetype === 'image/png') {
            cb(null, true);
        } else {
            cb(new Error('Solo se permiten archivos JPEG, JPG y PNG'), false);
        }
    },
});

// Endpoint para insertar el perfil de empresa
router.post('/insert', (req, res, next) => {
    upload.single('logo')(req, res, (err) => {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).send('El archivo es demasiado grande. El tamaño máximo permitido es de 10MB.');
        } else if (err) {
            return res.status(400).send(err.message);
        }
        next();
    });
}, (req, res) => {
    const { 
        nombre_pagina, 
        calle_numero, 
        localidad, 
        municipio, 
        estado, 
        codigo_postal, 
        pais, 
        telefono_principal, 
        correo_electronico, 
        sitio_web, 
        descripcion, 
        slogan 
    } = req.body;
    
    const logo = req.file ? req.file.buffer : null;

    if (!nombre_pagina || !correo_electronico) {
        return res.status(400).send('Nombre de página y correo electrónico son obligatorios');
    }

    const query = `INSERT INTO inf_perfil_empresa (
        nombre_pagina, 
        calle_numero, 
        localidad, 
        municipio, 
        estado, 
        codigo_postal, 
        pais, 
        telefono_principal, 
        correo_electronico, 
        sitio_web, 
        descripcion, 
        logo, 
        slogan
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    db.query(query, [
        nombre_pagina, 
        calle_numero, 
        localidad, 
        municipio || 'Huejutla', 
        estado || 'Hidalgo', 
        codigo_postal, 
        pais || 'México', 
        telefono_principal, 
        correo_electronico, 
        sitio_web, 
        descripcion, 
        logo, 
        slogan
    ], (err, result) => {
        if (err) {
            console.log(err);
            return res.status(500).send('Error en el servidor');
        }
        res.status(200).send('Perfil de empresa insertado con éxito');
    });
});

// Endpoint para obtener el perfil de empresa
router.get('/get', (req, res) => {
    const query = `SELECT * FROM inf_perfil_empresa LIMIT 1`;
    db.query(query, (err, results) => {
        if (err) {
            console.log(err);
            return res.status(500).send('Error en el servidor');
        }
        if (results.length === 0) {
            return res.status(404).send('Perfil de empresa no encontrado');
        }

        const perfilEmpresa = results[0];

        // Convertir el logo (longblob) a base64
        if (perfilEmpresa.logo) {
            perfilEmpresa.logo = perfilEmpresa.logo.toString('base64');
        }

        res.status(200).json(perfilEmpresa);
    });
});

// Endpoint para actualizar el logo de la empresa
router.put('/updateLogo', (req, res, next) => {
    upload.single('logo')(req, res, (err) => {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).send('El archivo es demasiado grande. El tamaño máximo permitido es de 10MB.');
        } else if (err) {
            return res.status(400).send(err.message);
        }
        next();
    });
}, (req, res) => {
    const { id_empresa } = req.body;
    const logo = req.file ? req.file.buffer : null;

    if (!id_empresa) {
        return res.status(400).send('El id_empresa es obligatorio para actualizar el logo');
    }

    if (!logo) {
        return res.status(400).send('No se ha proporcionado un logo para actualizar');
    }

    const query = `UPDATE inf_perfil_empresa SET logo = ? WHERE id_empresa = ?`;

    db.query(query, [logo, id_empresa], (err, result) => {
        if (err) {
            console.log(err);
            return res.status(500).send('Error en el servidor al actualizar el logo');
        }

        if (result.affectedRows === 0) {
            return res.status(404).send('Perfil de empresa no encontrado');
        }

        res.status(200).send('Logo actualizado con éxito');
    });
});

// Endpoint para actualizar datos de la empresa
router.put('/updateDatos', (req, res) => {
    const { 
        id_empresa, 
        nombre_pagina, 
        calle_numero, 
        localidad, 
        municipio, 
        estado, 
        codigo_postal, 
        pais, 
        telefono_principal, 
        correo_electronico, 
        sitio_web, 
        descripcion, 
        slogan 
    } = req.body;

    if (!id_empresa) {
        return res.status(400).send('El id_empresa es obligatorio para actualizar los datos');
    }

    if (!nombre_pagina || !correo_electronico) {
        return res.status(400).send('Nombre de página y correo electrónico son obligatorios');
    }

    const query = `UPDATE inf_perfil_empresa SET 
        nombre_pagina = ?, 
        calle_numero = ?, 
        localidad = ?, 
        municipio = ?, 
        estado = ?, 
        codigo_postal = ?, 
        pais = ?, 
        telefono_principal = ?, 
        correo_electronico = ?, 
        sitio_web = ?, 
        descripcion = ?, 
        slogan = ? 
        WHERE id_empresa = ?`;

    const queryParams = [
        nombre_pagina, 
        calle_numero, 
        localidad, 
        municipio || 'Huejutla', 
        estado || 'Hidalgo', 
        codigo_postal, 
        pais || 'México', 
        telefono_principal, 
        correo_electronico, 
        sitio_web, 
        descripcion, 
        slogan, 
        id_empresa
    ];

    db.query(query, queryParams, (err, result) => {
        if (err) {
            console.log(err);
            return res.status(500).send('Error en el servidor al actualizar los datos');
        }

        if (result.affectedRows === 0) {
            return res.status(404).send('Perfil de empresa no encontrado');
        }

        res.status(200).send('Datos de la empresa actualizados con éxito');
    });
});

// Endpoint para eliminar el perfil de empresa
router.delete('/delete/:id', (req, res) => {
    const { id } = req.params;

    const query = `DELETE FROM inf_perfil_empresa WHERE id_empresa = ?`;
    db.query(query, [id], (err, result) => {
        if (err) {
            console.log(err);
            return res.status(500).send('Error en el servidor');
        }
        res.status(200).send('Perfil de empresa eliminado con éxito');
    });
});

// Endpoint para obtener el nombre de la empresa y el logo
router.get('/getTitleAndLogo', (req, res) => {
    const query = `SELECT nombre_pagina, logo FROM inf_perfil_empresa LIMIT 1`;

    db.query(query, (err, results) => {
        if (err) {
            console.log(err);
            return res.status(500).send('Error en el servidor al obtener los datos');
        }

        if (results.length === 0) {
            return res.status(404).send('No se encontraron datos');
        }

        const perfilEmpresa = results[0];

        // Convertir el logo a base64 para enviarlo al frontend
        if (perfilEmpresa.logo) {
            perfilEmpresa.logo = perfilEmpresa.logo.toString('base64');
        }

        // Enviar el nombre de la empresa y el logo
        res.status(200).json({
            nombre_pagina: perfilEmpresa.nombre_pagina,
            logo: perfilEmpresa.logo,
        });
    });
});

// Endpoint para obtener los datos básicos de la empresa para contacto/footer
router.get('/empresa', (req, res) => {
    const query = `
        SELECT 
            nombre_pagina, 
            slogan, 
            calle_numero, 
            localidad, 
            municipio, 
            estado, 
            codigo_postal, 
            telefono_principal, 
            correo_electronico, 
            sitio_web 
        FROM inf_perfil_empresa 
        LIMIT 1
    `; 
    
    db.query(query, (err, results) => {
        if (err) {
            console.error('Error al obtener los datos de la empresa:', err);
            return res.status(500).json({ message: 'Error al obtener los datos de la empresa.' });
        }
        if (results.length === 0) {
            return res.status(404).json({ message: 'No se encontraron datos de la empresa.' });
        }
        res.status(200).json(results[0]); // Retornar el primer resultado
    });
});

// Endpoint para obtener dirección completa formateada
router.get('/direccion', (req, res) => {
    const query = `
        SELECT 
            calle_numero, 
            localidad, 
            municipio, 
            estado, 
            codigo_postal, 
            pais
        FROM inf_perfil_empresa 
        LIMIT 1
    `;
    
    db.query(query, (err, results) => {
        if (err) {
            console.error('Error al obtener la dirección:', err);
            return res.status(500).json({ message: 'Error al obtener la dirección.' });
        }
        
        if (results.length === 0) {
            return res.status(404).json({ message: 'No se encontró información de dirección.' });
        }
        
        const dir = results[0];
        
        // Formatear la dirección completa para mostrar
        const direccionCompleta = `${dir.calle_numero}, ${dir.localidad}, ${dir.municipio}, ${dir.estado}, C.P. ${dir.codigo_postal}, ${dir.pais}`;
        
        res.status(200).json({
            direccionDesglosada: dir,
            direccionCompleta: direccionCompleta
        });
    });
});

/**
 * Endpoint para obtener información para el header/footer 
 * Combina datos de dirección, teléfono y horarios
 */
router.get('/infoHeader', (req, res) => {
    // Obtener el día de la semana actual (Lunes, Martes, etc.)
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 es domingo, 1 es lunes, etc.
    
    // Convertir el número del día a nombre en español
    const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const currentDayName = dayNames[dayOfWeek];
    
    // Consulta para obtener información de la empresa
    const queryEmpresa = `
        SELECT 
            calle_numero,
            localidad, 
            municipio, 
            estado, 
            telefono_principal 
        FROM inf_perfil_empresa 
        LIMIT 1
    `;
    
    // Consulta para obtener los horarios del día actual
    const queryHorario = `
        SELECT 
            dia_semana, 
            hora_inicio, 
            hora_fin 
        FROM horarios 
        WHERE dia_semana = ?
        ORDER BY hora_inicio ASC
    `;
    
    // Consulta para obtener el resumen de horarios de toda la semana
    const querySemana = `
        SELECT 
            dia_semana, 
            MIN(hora_inicio) as hora_min, 
            MAX(hora_fin) as hora_max 
        FROM horarios 
        GROUP BY dia_semana
        ORDER BY FIELD(dia_semana, 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo')
    `;
    
    // Ejecutar consulta para obtener datos de la empresa
    db.query(queryEmpresa, (err, empresaResults) => {
        if (err) {
            console.error('Error al obtener datos de empresa:', err);
            return res.status(500).json({ message: 'Error en el servidor al obtener información de la empresa.' });
        }
        
        if (empresaResults.length === 0) {
            return res.status(404).json({ message: 'No se encontró información de la empresa.' });
        }
        
        const empresa = empresaResults[0];
        
        // Ejecutar consulta para obtener horarios del día actual
        db.query(queryHorario, [currentDayName], (err, horarioResults) => {
            if (err) {
                console.error('Error al obtener horarios del día:', err);
                return res.status(500).json({ message: 'Error en el servidor al obtener horarios.' });
            }
            
            // Formatear horarios de hoy
            const horariosHoy = [];
            let estaAbierto = false;
            
            if (horarioResults.length > 0) {
                estaAbierto = true; // Podría estar abierto si hay horarios para hoy
                
                horarioResults.forEach(horario => {
                    // Formatear hora (quitar segundos)
                    const inicio = horario.hora_inicio.substring(0, 5);
                    const fin = horario.hora_fin.substring(0, 5);
                    horariosHoy.push(`${inicio} - ${fin}`);
                });
            } else {
                horariosHoy.push("Cerrado hoy");
            }
            
            // Obtener resumen semanal de horarios
            db.query(querySemana, (err, semanaResults) => {
                if (err) {
                    console.error('Error al obtener horarios semanales:', err);
                    return res.status(500).json({ message: 'Error en el servidor al obtener horarios semanales.' });
                }
                
                // Determinar rango de días de trabajo y horario general
                let diasLaborables = "";
                
                if (semanaResults.length > 0) {
                    // Verificar si los días van de lunes a viernes
                    const dias = semanaResults.map(d => d.dia_semana);
                    const hayLunes = dias.includes('Lunes');
                    const hayViernes = dias.includes('Viernes');
                    
                    // Determinar si todos los días tienen el mismo horario
                    let mismoHorario = true;
                    const primerHoraMin = semanaResults[0].hora_min;
                    const primerHoraMax = semanaResults[0].hora_max;
                    
                    semanaResults.forEach(dia => {
                        if (dia.hora_min.toString() !== primerHoraMin.toString() || 
                            dia.hora_max.toString() !== primerHoraMax.toString()) {
                            mismoHorario = false;
                        }
                    });
                    
                    // Si hay días continuos de lunes a viernes
                    if (hayLunes && hayViernes && 
                        dias.includes('Martes') && 
                        dias.includes('Miércoles') && 
                        dias.includes('Jueves')) {
                        
                        // Si el horario es el mismo para todos los días, simplificamos
                        if (mismoHorario) {
                            const inicio = primerHoraMin.substring(0, 5);
                            const fin = primerHoraMax.substring(0, 5);
                            diasLaborables = `Lun - Vie: ${inicio} - ${fin}`;
                        } else {
                            // Buscar el horario más amplio si son diferentes
                            let horaMinGeneral = '23:59';
                            let horaMaxGeneral = '00:00';
                            
                            semanaResults.forEach(dia => {
                                const horaMin = dia.hora_min.substring(0, 5);
                                const horaMax = dia.hora_max.substring(0, 5);
                                
                                if (horaMin < horaMinGeneral) horaMinGeneral = horaMin;
                                if (horaMax > horaMaxGeneral) horaMaxGeneral = horaMax;
                            });
                            
                            diasLaborables = `Lun - Vie: ${horaMinGeneral} - ${horaMaxGeneral}`;
                        }
                    } else {
                        // Para días no consecutivos o si no hay lunes a viernes completos
                        // Usamos abreviaturas
                        const abreviaturas = {
                            'Lunes': 'Lun', 
                            'Martes': 'Mar', 
                            'Miércoles': 'Mié', 
                            'Jueves': 'Jue', 
                            'Viernes': 'Vie', 
                            'Sábado': 'Sáb', 
                            'Domingo': 'Dom'
                        };
                        
                        // Si todos tienen el mismo horario
                        if (mismoHorario) {
                            const diasAbreviados = dias.map(d => abreviaturas[d]).join(', ');
                            const inicio = primerHoraMin.substring(0, 5);
                            const fin = primerHoraMax.substring(0, 5);
                            diasLaborables = `${diasAbreviados}: ${inicio} - ${fin}`;
                        } else {
                            // Si tienen horarios diferentes, mostrar solo días
                            const diasAbreviados = dias.map(d => abreviaturas[d]).join(', ');
                            diasLaborables = `${diasAbreviados}: Horario variable`;
                        }
                    }
                } else {
                    diasLaborables = "Horario no disponible";
                }
                
                // Construir la dirección completa y abreviada
                const direccionCompleta = `${empresa.calle_numero}, ${empresa.localidad}, ${empresa.municipio}, ${empresa.estado}`;
                const direccionCorta = `${empresa.calle_numero}, ${empresa.localidad}`;
                
                // Enviar respuesta con toda la información formateada
                res.status(200).json({
                    direccion: direccionCompleta,
                    direccionCorta: direccionCorta,
                    telefono: empresa.telefono_principal,
                    horarioHoy: {
                        dia: currentDayName,
                        horarios: horariosHoy,
                        estaAbierto: estaAbierto
                    },
                    horarioGeneral: diasLaborables
                });
            });
        });
    });
});

// Exportar el router
module.exports = router;