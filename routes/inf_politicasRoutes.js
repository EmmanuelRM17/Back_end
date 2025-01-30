const express = require('express');
const db = require('../db'); // Asegúrate de que la ruta a tu conexión de base de datos sea correcta
const router = express.Router();
//POLITICAS
// Ruta para insertar una nueva política de privacidad
router.post('/insert', async (req, res) => {
    const { titulo, contenido } = req.body;

    // Validar los campos requeridos
    if (!titulo || !contenido) {
        return res.status(400).send('El título y el contenido son obligatorios.');
    }

    try {
        // Desactivar todas las políticas actuales antes de insertar una nueva
        await db.promise().query(`UPDATE inf_politicas_privacidad SET estado = 'inactivo'`);

        // Determinar el número de la próxima versión principal
        const [result] = await db.promise().query(`
            SELECT MAX(CAST(version AS DECIMAL(5, 1))) AS max_version 
            FROM inf_politicas_privacidad
        `);

        let newVersion;
        if (result[0].max_version === null) {
            // Si no existen políticas, la primera versión será "1.0"
            newVersion = "1.0";
        } else {
            // Si existen políticas, incrementar la versión principal
            const nextVersionNumber = Math.floor(result[0].max_version) + 1;
            newVersion = `${nextVersionNumber}.0`;
        }

        const insertQuery = `
            INSERT INTO inf_politicas_privacidad (numero_politica, titulo, contenido, estado, version, fecha_creacion, fecha_actualizacion)
            VALUES (0, ?, ?, 'activo', ?, NOW(), NOW())
        `;

        // Inserción de la nueva política con número de política fijo en 0
        await db.promise().query(insertQuery, [titulo, contenido, newVersion]);

        res.status(200).send('Política insertada con éxito.');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al insertar la política.');
    }
});


// Ruta para actualizar una política existente
router.put('/update/:id', async (req, res) => {
    const { id } = req.params;
    const { titulo, contenido } = req.body;

    // Validar que título y contenido sean enviados
    if (!titulo || !contenido) {
        return res.status(400).send('El título y el contenido son obligatorios.');
    }

    try {
        // Obtener la versión actual de la política específica a actualizar
        const getPolicyQuery = `SELECT version FROM inf_politicas_privacidad WHERE id = ?`;
        const [policy] = await db.promise().query(getPolicyQuery, [id]);

        if (policy.length === 0) {
            return res.status(404).send('Política no encontrada.');
        }

        const currentVersion = parseFloat(policy[0].version);
        const newVersion = (currentVersion + 0.1).toFixed(1); // Nueva versión incrementada en 0.1

        // Desactivar la política actual
        await db.promise().query(`UPDATE inf_politicas_privacidad SET estado = 'inactivo' WHERE id = ?`, [id]);

        // Insertar la nueva política con versión incrementada y estado activo
        const insertQuery = `
            INSERT INTO inf_politicas_privacidad (numero_politica, titulo, contenido, estado, version, fecha_creacion, fecha_actualizacion)
            VALUES (0, ?, ?, 'activo', ?, NOW(), NOW())
        `;
        await db.promise().query(insertQuery, [titulo, contenido, newVersion]);

        res.status(200).send('Política actualizada correctamente.');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al actualizar la política.');
    }
});

// Ruta para obtener una política específica por ID
router.get('/get/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const [result] = await db.promise().query(`SELECT * FROM inf_politicas_privacidad WHERE id = ?`, [id]);
        if (result.length === 0) {
            return res.status(404).send('Política no encontrada.');
        }
        res.status(200).json(result[0]);
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al obtener la política.');
    }
});
 
// Ruta para eliminar lógicamente una política de privacidad
router.put('/deactivate/:id', (req, res) => {
    const { id } = req.params;

    const query = 'UPDATE inf_politicas_privacidad SET estado = ? WHERE id = ?';

    db.promise().query(query, ['inactivo', id])
        .then(() => {
            res.status(200).send('Política de privacidad eliminada (lógicamente) con éxito');
        })
        .catch(err => {
            console.log(err);
            res.status(500).send('Error en el servidor');
        });
});

// Ruta para obtener la política activa más reciente
router.get('/getpolitica', (req, res) => {
    const query = 'SELECT * FROM inf_politicas_privacidad WHERE estado = "activo" ORDER BY version DESC LIMIT 1';

    db.promise().query(query)
        .then(([results]) => {
            if (results.length === 0) {
                return res.status(404).json({ message: 'No hay políticas activas' });
            }
            res.status(200).json(results[0]);  // Devolver solo la política más reciente
        })
        .catch(err => {
            console.log(err);
            res.status(500).send('Error en el servidor');
        });
});

// Ruta para obtener todas las políticas (activas e inactivas)
router.get('/getAllPoliticas', (req, res) => {
    const query = 'SELECT * FROM inf_politicas_privacidad ORDER BY numero_politica, CAST(version AS DECIMAL(5,1)) ASC';

    db.promise().query(query)
        .then(([results]) => {
            res.status(200).json(results);
        })
        .catch(err => {
            console.log(err);
            res.status(500).send('Error en el servidor');
        });
});

// Endpoint para obtener las políticas de privacidad activas
router.get('/politicas_privacidad', (req, res) => {
    const sql = 'SELECT * FROM inf_politicas_privacidad WHERE estado = "activo"';
    db.query(sql, (err, result) => {
      if (err) {
        return res.status(500).json({ message: 'Error al obtener las políticas de privacidad.' });
      }
      res.status(200).json(result);
    });
  });
  
module.exports = router;
