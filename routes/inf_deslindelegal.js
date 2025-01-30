const express = require('express');
const db = require('../db'); // Asegúrate de que la ruta a tu conexión de base de datos sea correcta
const router = express.Router();

// DESLINDE

// Ruta para insertar un nuevo deslinde
router.post('/insert', async (req, res) => {
    const { titulo, contenido } = req.body;

    if (!titulo || !contenido) {
        return res.status(400).send('El título y el contenido son obligatorios.');
    }

    try {
        // Desactivar todos los deslindes actuales antes de insertar uno nuevo
        await db.promise().query(`UPDATE inf_deslinde SET estado = 'inactivo'`);

        // Determinar el número de la próxima versión principal
        const [result] = await db.promise().query(`
            SELECT MAX(CAST(version AS DECIMAL(5, 1))) AS max_version 
            FROM inf_deslinde
        `);

        let newVersion;
        if (result[0].max_version === null) {
            // Si no existen deslindes, la primera versión será "1.0"
            newVersion = "1.0";
        } else {
            // Si existen deslindes, incrementar la versión principal
            const nextVersionNumber = Math.floor(result[0].max_version) + 1;
            newVersion = `${nextVersionNumber}.0`;
        }

        const insertQuery = `
            INSERT INTO inf_deslinde (numero_deslinde, titulo, contenido, estado, version, fecha_creacion, fecha_actualizacion)
            VALUES (0, ?, ?, 'activo', ?, NOW(), NOW())
        `;
        await db.promise().query(insertQuery, [titulo, contenido, newVersion]);

        res.status(200).send('Deslinde insertado con éxito.');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al insertar el deslinde.');
    }
});

// Ruta para actualizar un deslinde existente
router.put('/update/:id', async (req, res) => {
    const { id } = req.params;
    const { titulo, contenido } = req.body;

    if (!titulo || !contenido) {
        return res.status(400).send('El título y el contenido son obligatorios.');
    }

    try {
        // Obtener la versión actual del deslinde a actualizar
        const getDeslindeQuery = `SELECT version FROM inf_deslinde WHERE id = ?`;
        const [deslinde] = await db.promise().query(getDeslindeQuery, [id]);

        if (deslinde.length === 0) {
            return res.status(404).send('Deslinde no encontrado.');
        }

        const currentVersion = parseFloat(deslinde[0].version);
        const newVersion = (currentVersion + 0.1).toFixed(1); // Nueva versión aumentada en 0.1

        // Desactivar el deslinde actual antes de insertar la nueva versión
        await db.promise().query(`UPDATE inf_deslinde SET estado = 'inactivo' WHERE id = ?`, [id]);

        // Insertar nuevo deslinde con versión incrementada y estado activo
        const insertQuery = `
            INSERT INTO inf_deslinde (numero_deslinde, titulo, contenido, estado, version, fecha_creacion, fecha_actualizacion)
            VALUES (0, ?, ?, 'activo', ?, NOW(), NOW())
        `;
        await db.promise().query(insertQuery, [titulo, contenido, newVersion]);

        res.status(200).send('Deslinde actualizado correctamente.');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al actualizar el deslinde.');
    }
});


// Ruta para obtener un deslinde específico por ID
router.get('/get/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const [result] = await db.promise().query(`SELECT * FROM inf_deslinde WHERE id = ?`, [id]);
        if (result.length === 0) {
            return res.status(404).send('Deslinde no encontrado.');
        }
        res.status(200).json(result[0]);
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al obtener el deslinde.');
    }
});

// Ruta para desactivar (eliminar lógicamente) un deslinde
router.put('/deactivate/:id', (req, res) => {
    const { id } = req.params;

    const query = 'UPDATE inf_deslinde SET estado = ? WHERE id = ?';

    db.promise().query(query, ['inactivo', id])
        .then(() => {
            res.status(200).send('Deslinde eliminado (lógicamente) con éxito');
        })
        .catch(err => {
            console.log(err);
            res.status(500).send('Error en el servidor');
        });
});

// Ruta para obtener el deslinde activo más reciente
router.get('/getdeslinde', (req, res) => {
    const query = 'SELECT * FROM inf_deslinde WHERE estado = "activo" ORDER BY version DESC LIMIT 1';

    db.promise().query(query)
        .then(([results]) => {
            if (results.length === 0) {
                return res.status(404).json({ message: 'No hay deslindes activos' });
            }
            res.status(200).json(results[0]);  // Devolver solo el deslinde más reciente
        })
        .catch(err => {
            console.log(err);
            res.status(500).send('Error en el servidor');
        });
});

// Ruta para obtener todos los deslindes (activos e inactivos)
router.get('/getAllDeslindes', (req, res) => {
    const query = 'SELECT * FROM inf_deslinde ORDER BY numero_deslinde, CAST(version AS DECIMAL(5,1)) ASC';

    db.promise().query(query)
        .then(([results]) => {
            res.status(200).json(results);
        })
        .catch(err => {
            console.log(err);
            res.status(500).send('Error en el servidor');
        });
});
// Endpoint para obtener el deslinde legal activo
router.get('/deslinde', (req, res) => {
    const sql = 'SELECT * FROM inf_deslinde WHERE estado = "activo"';
    db.query(sql, (err, result) => {
      if (err) {
        return res.status(500).json({ message: 'Error al obtener el deslinde legal.' });
      }
      res.status(200).json(result);
    });
  });
  

module.exports = router;
