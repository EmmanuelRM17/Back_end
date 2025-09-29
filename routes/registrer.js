const express = require("express");
const db = require("../db");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const xss = require("xss");
const { RateLimiterMemory } = require("rate-limiter-flexible");
const cron = require("node-cron");
const router = express.Router();
const logger = require("../utils/logger");

// Configuración del limitador para ataques de fuerza bruta
const rateLimiter = new RateLimiterMemory({
  points: 10,
  duration: 3 * 60 * 60,
});

// Configuración de nodemailer
const transporter = nodemailer.createTransport({
  host: "smtp.hostinger.com",
  port: 587,
  secure: false, // Usa STARTTLS en lugar de SSL directo
  requireTLS: true, // Fuerza el uso de TLS para seguridad
  auth: {
    user: "sistema@odontologiacarol.com",
    pass: "sP8+?;Vs:",
  },
  connectionTimeout: 60000, // 60 segundos de tiempo de espera
  greetingTimeout: 30000, // 30 segundos para el saludo del servidor
  socketTimeout: 30000 // 30 segundos para operaciones de socket
});

// Función para eliminar registros incompletos después de 10 minutos
const eliminarRegistrosIncompletos = () => {
  const sql = `DELETE FROM pacientes 
      WHERE registro_completo = 0 
      AND TIMESTAMPDIFF(MINUTE, fecha_creacion, NOW()) > 10`;
  db.query(sql, (err, result) => {
    if (err) {
      console.error("Error al eliminar registros incompletos:", err);
    } else {
      console.log(`${result.affectedRows} registros incompletos eliminados.`);
    }
  });
};
// Configuración del cron job para ejecutar la limpieza cada 10 minutos
cron.schedule("*/10 * * * *", () => {
  console.log("Ejecutando limpieza de registros incompletos...");
  eliminarRegistrosIncompletos();
});

// Generar un token alfanumérico de 6 caracteres (mayúsculas y números)
function generateToken() {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let token = "";
  for (let i = 0; i < 6; i++) {
    token += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return token;
}

// Ruta para registrar un nuevo usuario
router.post("/register", async (req, res) => {
  try {
    logger.info("Intento de registro de usuario.");

    const nombre = xss(req.body.nombre);
    const aPaterno = xss(req.body.aPaterno);
    const aMaterno = xss(req.body.aMaterno);
    const fechaNacimiento = xss(req.body.fechaNacimiento);
    const genero = xss(req.body.genero);
    const lugar = xss(req.body.lugar);
    const telefono = xss(req.body.telefono);
    const email = xss(req.body.email);

    // Procesar alergias y condiciones médicas por separado
    const alergias = JSON.stringify(req.body.alergias || []);
    const condicionesMedicas = JSON.stringify(
      req.body.condicionesMedicas || []
    );

    const password = xss(req.body.password);
    const tipoTutor = xss(req.body.tipoTutor);
    const nombreTutor = xss(req.body.nombreTutor);

    // Validación de campos obligatorios
    if (
      !nombre ||
      !aPaterno ||
      !aMaterno ||
      !fechaNacimiento ||
      !genero ||
      !lugar ||
      !email ||
      !password
    ) {
      return res
        .status(400)
        .json({ message: "Todos los campos son obligatorios" });
    }

    // Permitir que el usuario no tenga teléfono
    if (!telefono && req.body.noTieneTelefono !== true) {
      return res
        .status(400)
        .json({
          message: "Debe proporcionar un teléfono o marcar que no tiene",
        });
    }

    // Si es menor de edad, validar datos del tutor
    const hoy = new Date();
    const nacimiento = new Date(fechaNacimiento);
    const edad =
      hoy.getFullYear() -
      nacimiento.getFullYear() -
      (hoy <
      new Date(hoy.getFullYear(), nacimiento.getMonth(), nacimiento.getDate())
        ? 1
        : 0);
    const esMenorDeEdad = edad < 18;

    if (esMenorDeEdad && (!tipoTutor || !nombreTutor)) {
      return res
        .status(400)
        .json({
          message: "Si es menor de edad, los campos de tutor son obligatorios",
        });
    }

    const ipAddress = req.ip; // Obtener la dirección IP para limitar intentos

    try {
      await rateLimiter.consume(ipAddress);

      const checkUserSql = "SELECT * FROM pacientes WHERE email = ?";
      db.query(checkUserSql, [email], async (err, result) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Error al verificar el correo electrónico" });
        }

        if (result.length > 0) {
          const paciente = result[0];
          if (paciente.registro_completo === 1) {
            return res
              .status(400)
              .json({
                message:
                  "El correo electrónico ya está registrado y el registro está completo.",
              });
          } else {
            // Si el correo ya existe pero no ha completado el registro
            const updateSql = `
                            UPDATE pacientes 
                            SET nombre = ?, aPaterno = ?, aMaterno = ?, fechaNacimiento = ?, genero = ?, 
                            lugar = ?, telefono = ?, alergias = ?, condiciones_medicas = ?, 
                            tipoTutor = ?, nombreTutor = ?, password = ?, registro_completo = 1 
                            WHERE email = ?
                        `;
            const hashedPassword = await bcrypt.hash(password, 10);

            db.query(
              updateSql,
              [
                nombre,
                aPaterno,
                aMaterno,
                fechaNacimiento,
                genero,
                lugar,
                telefono,
                alergias,
                condicionesMedicas,
                tipoTutor,
                nombreTutor,
                hashedPassword,
                email,
              ],
              (err, result) => {
                if (err) {
                  logger.error("Error al completar el registro:", err);
                  return res
                    .status(500)
                    .json({ message: "Error al completar el registro." });
                }
                return res
                  .status(200)
                  .json({ message: "Registro completado correctamente." });
              }
            );
          }
        } else {
          // Nuevo registro
          const saltRounds = 10;
          const hashedPassword = await bcrypt.hash(password, saltRounds);

          const insertSql = `
                        INSERT INTO pacientes (
                            nombre, aPaterno, aMaterno, fechaNacimiento, genero, 
                            lugar, telefono, email, alergias, condiciones_medicas, 
                            tipoTutor, nombreTutor, password, registro_completo
                        ) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                    `;
          db.query(
            insertSql,
            [
              nombre,
              aPaterno,
              aMaterno,
              fechaNacimiento,
              genero,
              lugar,
              telefono,
              email,
              alergias,
              condicionesMedicas,
              tipoTutor,
              nombreTutor,
              hashedPassword,
            ],
            (err, result) => {
              if (err) {
                logger.error("Error al registrar el paciente:", err);
                return res
                  .status(500)
                  .json({ message: "Error al registrar el paciente." });
              }
              logger.info("Paciente registrado correctamente.");
              return res
                .status(201)
                .json({ message: "Paciente registrado correctamente." });
            }
          );
        }
      });
    } catch (rateLimiterError) {
      return res
        .status(429)
        .json({
          message: "Demasiados intentos. Inténtalo de nuevo más tarde.",
        });
    }
  } catch (error) {
    logger.error(`Error en /register: ${error.message}`);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// Endpoint para solicitar la recuperación de contraseña - Soporta múltiples tipos de usuario
router.post("/recuperacion", async (req, res) => {
  const { email } = req.body;
  const ipAddress = req.ip;

  try {
    await rateLimiter.consume(ipAddress);
    logger.info(
      `Intento de recuperación de contraseña para el email: ${email} desde la IP: ${ipAddress}`
    );

    if (!validateEmail(email)) {
      return res.status(400).json({ message: "Formato de correo inválido." });
    }

    // Buscar usuario en las tres tablas secuencialmente
    const searchUser = async () => {
      const tables = ["pacientes", "empleados", "administradores"];

      for (const tabla of tables) {
        const query = `SELECT id, email FROM ${tabla} WHERE email = ?`;

        try {
          const result = await new Promise((resolve, reject) => {
            db.query(query, [email], (err, rows) => {
              if (err) reject(err);
              else resolve(rows);
            });
          });

          if (result.length > 0) {
            return { tabla, user: result[0] };
          }
        } catch (queryErr) {
          logger.error(`Error buscando en tabla ${tabla}:`, queryErr);
          continue;
        }
      }

      return null;
    };

    const userFound = await searchUser();

    if (!userFound) {
      return res
        .status(404)
        .json({ message: "No existe una cuenta con este correo electrónico." });
    }

    const { tabla } = userFound;
    const token = generateToken();
    const tokenExpiration = new Date(Date.now() + 900000);

    // Actualizar la tabla correspondiente
    const updateTokenSql = `UPDATE ${tabla} SET token_verificacion = ?, token_expiracion = ? WHERE email = ?`;

    db.query(
      updateTokenSql,
      [token, tokenExpiration, email],
      (err, updateResult) => {
        if (err) {
          logger.error("Error al actualizar token:", err);
          return res
            .status(500)
            .json({ message: "Error al generar el token de recuperación." });
        }

        // Configuración del correo
        const mailOptions = {
          from: '"Odontología Carol" <sistema@odontologiacarol.com>',
          to: email,
          subject: "Recuperación de Contraseña - Odontología Carol",
          html: `
                    <div style="font-family: 'Roboto', Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; background-color: #fafafa;">
                        <div style="background-color: #1976d2; padding: 20px; text-align: center; border-radius: 4px 4px 0 0;">
                            <h1 style="color: white; margin: 0; font-weight: 500; font-size: 22px;">Odontología Carol</h1>
                        </div>
                        <div style="padding: 30px 40px; background-color: white; box-shadow: 0 2px 5px rgba(0,0,0,0.1); border-radius: 0 0 4px 4px;">
                            <p style="font-size: 16px; margin: 0 0 20px;">¡Hola!</p>
                            <p style="font-size: 16px; margin: 0 0 15px; line-height: 1.5;">Hemos recibido una solicitud para restablecer tu contraseña en <b>Odontología Carol</b>.</p>
                            <p style="font-size: 16px; margin: 0 0 20px; line-height: 1.5;">Si no realizaste esta solicitud, puedes ignorar este correo. De lo contrario, utiliza el siguiente código para restablecer tu contraseña:</p>
                            
                            <div style="text-align: center;">
                                <div style="padding: 15px 25px; background-color: #e3f2fd; border-radius: 8px; display: inline-block; margin: 25px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                                    <span style="font-size: 28px; font-weight: 500; color: #1976d2; letter-spacing: 2px;">${token}</span>
                                </div>
                            </div>
                            
                            <div style="margin: 25px 0; padding: 15px; background-color: #fff8e1; border-left: 4px solid #d32f2f; border-radius: 4px;">
                                <p style="color: #d32f2f; font-weight: 500; font-size: 14px; margin: 0; line-height: 1.4;">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d32f2f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 5px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                                    Importante: El token debe ser copiado tal y como está, respetando los números y mayúsculas.
                                </p>
                            </div>
                            
                            <p style="font-size: 14px; color: #616161; margin: 20px 0; padding: 10px; background-color: #f5f5f5; border-radius: 4px;"><b>Nota:</b> Este código caduca en 15 minutos por seguridad.</p>
                        </div>
                        
                        <div style="text-align: center; padding: 20px; color: #757575; font-size: 13px; border-top: 1px solid #eaeaea;">
                            <p style="margin: 0 0 5px;">Odontología Carol - Cuidando de tu salud bucal</p>
                            <p style="margin: 0; color: #9e9e9e;">Este es un correo generado automáticamente, por favor no respondas a este mensaje.</p>
                        </div>
                    </div>
                `,
        };

        transporter.sendMail(mailOptions, (err, info) => {
          if (err) {
            logger.error("Error al enviar el correo de recuperación:", err);
            return res
              .status(500)
              .json({ message: "Error al enviar el correo de recuperación." });
          }
          logger.info(
            `Correo de recuperación enviado correctamente a: ${email} (tipo: ${tabla})`
          );
          res
            .status(200)
            .json({
              message: "Se ha enviado un enlace de recuperación a tu correo.",
            });
        });
      }
    );
  } catch (rateLimiterError) {
    logger.warn(
      `Demasiados intentos de recuperación de contraseña desde la IP: ${ipAddress}`
    );
    return res
      .status(429)
      .json({ message: "Demasiados intentos. Inténtalo más tarde." });
  }
});

// Validar formato del correo electrónico
function validateEmail(email) {
  const re =
    /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@(([^<>()[\]\\.,;:\s@"]+\.)+[^<>()[\]\\.,;:\s@"]{2,})$/i;
  return re.test(String(email).toLowerCase());
}

// Endpoint para verificar el token de recuperación
router.post("/verifyTokene", async (req, res) => {
  const { token, email } = req.body;

  try {
    // Buscar usuario en las tres tablas secuencialmente
    const searchUserWithToken = async () => {
      const tables = ["pacientes", "empleados", "administradores"];

      for (const tabla of tables) {
        const query = `SELECT * FROM ${tabla} WHERE email = ? AND token_verificacion = ?`;

        try {
          const result = await new Promise((resolve, reject) => {
            db.query(query, [xss(email), xss(token)], (err, rows) => {
              if (err) reject(err);
              else resolve(rows);
            });
          });

          if (result.length > 0) {
            return { tabla, user: result[0] };
          }
        } catch (queryErr) {
          logger.error(`Error buscando token en tabla ${tabla}:`, queryErr);
          continue;
        }
      }

      return null;
    };

    const userFound = await searchUserWithToken();

    if (!userFound || new Date() > new Date(userFound.user.token_expiracion)) {
      return res
        .status(400)
        .json({ message: "Token no válido o ha expirado." });
    }

    res.status(200).json({ message: "Token verificado correctamente." });
  } catch (error) {
    console.error("Error en la verificación del token:", error);
    res
      .status(500)
      .json({ message: "Error en el servidor. Inténtalo de nuevo más tarde." });
  }
});

// Endpoint para cambiar la contraseña
router.post("/resetPassword", async (req, res) => {
  const { token, newPassword } = req.body;

  console.log("Token recibido:", token);
  console.log("Nueva contraseña recibida:", newPassword);

  try {
    // Buscar usuario con token en las tres tablas
    const searchUserWithToken = async () => {
      const tables = ["pacientes", "empleados", "administradores"];

      for (const tabla of tables) {
        const query = `SELECT * FROM ${tabla} WHERE token_verificacion = ?`;

        try {
          const result = await new Promise((resolve, reject) => {
            db.query(query, [xss(token)], (err, rows) => {
              if (err) reject(err);
              else resolve(rows);
            });
          });

          if (result.length > 0) {
            return { tabla, user: result[0] };
          }
        } catch (queryErr) {
          logger.error(`Error buscando token en tabla ${tabla}:`, queryErr);
          continue;
        }
      }

      return null;
    };

    const userFound = await searchUserWithToken();

    if (!userFound) {
      console.error("Token no encontrado en ninguna tabla.");
      return res.status(400).json({ message: "Token no válido." });
    }

    console.log("Token encontrado, verificando expiración...");

    if (new Date() > new Date(userFound.user.token_expiracion)) {
      console.error("El token ha expirado.");
      return res.status(400).json({ message: "Token ha expirado." });
    }

    console.log("Token válido y no ha expirado, verificando contraseña...");

    // Verificar si la nueva contraseña es la misma que la actual
    const passwordMatches = await bcrypt.compare(
      newPassword,
      userFound.user.password
    );
    if (passwordMatches) {
      console.error("La nueva contraseña no puede ser igual a la actual.");
      return res
        .status(400)
        .json({
          message: "La nueva contraseña no puede ser igual a la actual.",
        });
    }

    // Encriptar la nueva contraseña
    const hashedPassword = await bcrypt.hash(xss(newPassword), 10);

    // Actualizar la contraseña y limpiar el token en la tabla correspondiente
    const updatePasswordSql = `
            UPDATE ${userFound.tabla}
            SET password = ?, token_verificacion = NULL, token_expiracion = NULL
            WHERE token_verificacion = ?
        `;

    db.query(updatePasswordSql, [hashedPassword, token], (err, result) => {
      if (err) {
        console.error("Error al actualizar la contraseña:", err);
        return res
          .status(500)
          .json({ message: "Error al actualizar la contraseña." });
      }
      console.log(
        `Contraseña actualizada correctamente en tabla: ${userFound.tabla}`
      );
      res
        .status(200)
        .json({ message: "Contraseña actualizada correctamente." });
    });
  } catch (error) {
    console.error("Error al cambiar la contraseña:", error);
    res
      .status(500)
      .json({ message: "Error en el servidor. Inténtalo de nuevo más tarde." });
  }
});

// Ruta para enviar correo de verificación
router.post("/send-verification-email", (req, res) => {
  const { email } = req.body;

  const checkUserSql = "SELECT * FROM pacientes WHERE email = ?";
  db.query(checkUserSql, [xss(email)], (err, result) => {
    if (err) {
      return res
        .status(500)
        .json({ message: "Error al verificar el correo electrónico." });
    }

    if (result.length > 0 && result[0].verificado === 1) {
      return res
        .status(400)
        .json({ message: "El correo electrónico ya está registrado." });
    }

    if (result.length > 0) {
      return res
        .status(400)
        .json({ message: "El correo electrónico ya está registrado." });
    }
    // Generar token
    const verificationToken = generateToken();

    const tokenExpiration = new Date(Date.now() + 900000); // Expira en 15 minutos

    const sql = `
            INSERT INTO pacientes (email, token_verificacion, token_expiracion, verificado)
            VALUES (?, ?, ?, 0)
        `;
    db.query(
      sql,
      [email, verificationToken, tokenExpiration],
      async (err, result) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Error al generar el token de verificación." });
        }

        // Formatear el contenido HTML del correo
        const mailOptions = {
          from: '"Odontología Carol" <sistema@odontologiacarol.com>',
          to: email,
          subject: "Verificación de Correo - Odontología Carol",
          html: `
                <div style="font-family: 'Roboto', Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; background-color: #fafafa;">
                    <div style="background-color: #1976d2; padding: 20px; text-align: center; border-radius: 4px 4px 0 0;">
                        <h1 style="color: white; margin: 0; font-weight: 500; font-size: 22px;">Odontología Carol</h1>
                    </div>
                    <div style="padding: 30px 40px; background-color: white; box-shadow: 0 2px 5px rgba(0,0,0,0.1); border-radius: 0 0 4px 4px;">
                        <p style="font-size: 16px; margin: 0 0 20px;">¡Hola!</p>
                        <p style="font-size: 16px; margin: 0 0 15px; line-height: 1.5;">Gracias por registrarte en <b>Odontología Carol</b>. Para completar tu registro, por favor verifica tu correo electrónico utilizando el siguiente código:</p>
                        
                        <div style="text-align: center;">
                            <div style="padding: 15px 25px; background-color: #e3f2fd; border-radius: 8px; display: inline-block; margin: 25px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                                <span style="font-size: 28px; font-weight: 500; color: #1976d2; letter-spacing: 2px;">${verificationToken}</span>
                            </div>
                        </div>
                        
                        <p style="font-size: 15px; margin: 0 0 20px; text-align: center; color: #555;">Ingresa este código en la página de verificación de tu cuenta</p>
                        
                        <div style="margin: 25px 0; padding: 15px; background-color: #e8f5e9; border-left: 4px solid #2e7d32; border-radius: 4px;">
                            <p style="color: #2e7d32; font-weight: 500; font-size: 14px; margin: 0; line-height: 1.4;">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2e7d32" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 5px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                                Importante: El token debe ser copiado tal y como está, respetando los números y mayúsculas.
                            </p>
                        </div>
                        
                        <p style="font-size: 14px; color: #616161; margin: 20px 0; padding: 10px; background-color: #f5f5f5; border-radius: 4px;"><b>Nota:</b> Este código caduca en 15 minutos por seguridad.</p>
                    </div>
                    
                    <div style="text-align: center; padding: 20px; color: #757575; font-size: 13px; border-top: 1px solid #eaeaea;">
                        <p style="margin: 0 0 5px;">Odontología Carol - Cuidando de tu salud bucal</p>
                        <p style="margin: 0; color: #9e9e9e;">Este es un correo generado automáticamente, por favor no respondas a este mensaje.</p>
                    </div>
                </div>
                `,
        };

        try {
          await transporter.sendMail(mailOptions);
          res.status(200).json({ message: "Correo de verificación enviado." });
        } catch (mailError) {
          return res
            .status(500)
            .json({ message: "Error al enviar el correo de verificación." });
        }
      }
    );
  });
});

// Nueva ruta para verificar el token de forma manual
router.post("/verify-token", (req, res) => {
  const { token, email } = req.body;

  // Consulta para verificar el token y el email
  const verifySql =
    "SELECT * FROM pacientes WHERE email = ? AND token_verificacion = ?";
  db.query(verifySql, [email, token], (err, result) => {
    if (err) {
      console.error("Error en la consulta de verificación del token:", err); // Mostrar el error en la consola
      return res
        .status(500)
        .json({ message: "Error en el servidor al verificar el token." });
    }

    if (result.length === 0) {
      // Caso donde el token es incorrecto o no coincide con el email
      return res
        .status(400)
        .json({ message: "Token incorrecto. Por favor verifica el token." });
    }

    const tokenExpiration = new Date(result[0].token_expiracion);
    if (new Date() > tokenExpiration) {
      // Caso donde el token ha expirado
      return res
        .status(400)
        .json({ message: "El token ha expirado. Solicita un nuevo token." });
    }

    // Si todo está correcto, actualizar el estado de verificación del usuario
    const updateSql =
      "UPDATE pacientes SET verificado = 1, token_verificacion = NULL, token_expiracion = NULL WHERE email = ?";
    db.query(updateSql, [email], (err, result) => {
      if (err) {
        console.error("Error al actualizar el estado de verificación:", err);
        return res
          .status(500)
          .json({ message: "Error al verificar el usuario." });
      }

      // Respuesta exitosa
      res
        .status(200)
        .json({
          message: "Correo verificado correctamente. Ya puedes iniciar sesión.",
        });
    });
  });
});

// Envío de correo electrónico
router.post("/send-verification-code", async (req, res) => {
  const { email } = req.body;

  try {
    // Consultar en las diferentes tablas
    const findPatientSql = `SELECT 'pacientes' AS userType, email FROM pacientes WHERE email = ?`;
    const findAdminSql = `SELECT 'administradores' AS userType, email FROM administradores WHERE email = ?`;
    const findEmployeeSql = `SELECT 'empleados' AS userType, email FROM empleados WHERE email = ?`;

    // Buscar en la tabla de pacientes
    db.query(findPatientSql, [email], (err, patientResult) => {
      if (err) {
        console.error("Error al buscar en la tabla de pacientes:", err);
        return res
          .status(500)
          .json({ message: "Error en el servidor al buscar en pacientes." });
      }

      if (patientResult.length > 0) {
        // Si se encuentra en pacientes
        return handleVerificationCode("pacientes", email, res);
      }

      // Buscar en la tabla de administradores
      db.query(findAdminSql, [email], (err, adminResult) => {
        if (err) {
          console.error("Error al buscar en la tabla de administradores:", err);
          return res
            .status(500)
            .json({
              message: "Error en el servidor al buscar en administradores.",
            });
        }

        if (adminResult.length > 0) {
          // Si se encuentra en administradores
          return handleVerificationCode("administradores", email, res);
        }

        // Buscar en la tabla de empleados
        db.query(findEmployeeSql, [email], (err, employeeResult) => {
          if (err) {
            console.error("Error al buscar en la tabla de empleados:", err);
            return res
              .status(500)
              .json({
                message: "Error en el servidor al buscar en empleados.",
              });
          }

          if (employeeResult.length > 0) {
            // Si se encuentra en empleados
            return handleVerificationCode("empleados", email, res);
          }

          // Si no se encuentra en ninguna tabla
          return res
            .status(404)
            .json({
              message:
                "Usuario no encontrado en pacientes, administradores ni empleados.",
            });
        });
      });
    });
  } catch (error) {
    console.error("Error general en el servidor:", error);
    res.status(500).json({ message: "Error en el servidor." });
  }
});

// Función para manejar el envío del código de verificación
function handleVerificationCode(userType, email, res) {
  // Generar código de verificación
  const verificationCode = generateToken(); // Código de 6 dígitos
  const codeExpiration = new Date(Date.now() + 10 * 60000); // Expira en 10 minutos

  // Actualizar la tabla correspondiente con el código y su expiración
  const updateCodeSql = `
        UPDATE ${userType}
        SET token_verificacion = ?, token_expiracion = ?
        WHERE email = ?
    `;

  db.query(
    updateCodeSql,
    [verificationCode, codeExpiration, email],
    async (err) => {
      if (err) {
        console.error(`Error al guardar el código en ${userType}:`, err);
        return res
          .status(500)
          .json({ message: "Error al guardar el código de verificación." });
      }
      const mailOptions = {
        from: '"Odontología Carol" <sistema@odontologiacarol.com>',
        to: email,
        subject: "Código de Verificación - Odontología Carol",
        html: `
                <div style="font-family: 'Roboto', Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; background-color: #fafafa;">
                    <div style="background-color: #1976d2; padding: 20px; text-align: center; border-radius: 4px 4px 0 0;">
                        <h1 style="color: white; margin: 0; font-weight: 500; font-size: 22px;">Odontología Carol</h1>
                    </div>
                    <div style="padding: 30px 40px; background-color: white; box-shadow: 0 2px 5px rgba(0,0,0,0.1); border-radius: 0 0 4px 4px;">
                        <p style="font-size: 16px; margin: 0 0 20px;">¡Hola!</p>
                        <p style="font-size: 16px; margin: 0 0 15px; line-height: 1.5;">Gracias por confiar en <b>Odontología Carol</b>. Para continuar, ingresa el siguiente código de verificación en la página correspondiente:</p>
                        
                        <div style="text-align: center;">
                            <div style="padding: 15px 25px; background-color: #e3f2fd; border-radius: 8px; display: inline-block; margin: 25px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                                <span style="font-size: 28px; font-weight: 500; color: #1976d2; letter-spacing: 2px;">${verificationCode}</span>
                            </div>
                        </div>
                        
                        <div style="margin: 25px 0; padding: 15px; background-color: #f3e5f5; border-left: 4px solid #7b1fa2; border-radius: 4px;">
                            <p style="color: #7b1fa2; font-weight: 500; font-size: 14px; margin: 0; line-height: 1.4;">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7b1fa2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 5px;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
                                Por seguridad: Este código es válido por 10 minutos. No lo compartas con nadie.
                            </p>
                        </div>
                        
                        <div style="margin: 15px 0; padding: 15px; background-color: #ffebee; border-left: 4px solid #d32f2f; border-radius: 4px;">
                            <p style="color: #d32f2f; font-weight: 500; font-size: 14px; margin: 0; line-height: 1.4;">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d32f2f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 5px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                                Importante: Copia el código exactamente como está, respetando mayúsculas y minúsculas.
                            </p>
                        </div>
                    </div>
                    
                    <div style="text-align: center; padding: 20px; color: #757575; font-size: 13px; border-top: 1px solid #eaeaea;">
                        <p style="margin: 0 0 5px;">Odontología Carol - Cuidando de tu salud bucal</p>
                        <p style="margin: 0; color: #9e9e9e;">Este es un correo generado automáticamente, por favor no respondas a este mensaje.</p>
                    </div>
                </div>
                `,
      };
      try {
        // Enviar el correo
        await transporter.sendMail(mailOptions);
        return res
          .status(200)
          .json({ message: "Código de verificación enviado al correo." });
      } catch (mailError) {
        console.error("Error al enviar el correo:", mailError);
        return res
          .status(500)
          .json({ message: "Error al enviar el correo de verificación." });
      }
    }
  );
}

router.post("/verify-verification-code", async (req, res) => {
  const { email, code } = req.body;

  try {
    // Consultas para las diferentes tablas
    const findPatientSql = `SELECT 'pacientes' AS userType, token_verificacion, token_expiracion FROM pacientes WHERE email = ?`;
    const findAdminSql = `SELECT 'administradores' AS userType, token_verificacion, token_expiracion FROM administradores WHERE email = ?`;
    const findEmployeeSql = `SELECT 'empleados' AS userType, token_verificacion, token_expiracion FROM empleados WHERE email = ?`;

    // Buscar en la tabla de pacientes
    db.query(findPatientSql, [email], (err, patientResult) => {
      if (err) {
        console.error("Error al buscar en la tabla de pacientes:", err);
        return res
          .status(500)
          .json({ message: "Error en el servidor al buscar en pacientes." });
      }

      if (patientResult.length > 0) {
        // Verificar el código para pacientes
        return handleCodeVerification(
          "pacientes",
          patientResult[0],
          code,
          email,
          res,
          "pacientes"
        );
      }

      // Buscar en la tabla de administradores
      db.query(findAdminSql, [email], (err, adminResult) => {
        if (err) {
          console.error("Error al buscar en la tabla de administradores:", err);
          return res
            .status(500)
            .json({
              message: "Error en el servidor al buscar en administradores.",
            });
        }

        if (adminResult.length > 0) {
          // Verificar el código para administradores
          return handleCodeVerification(
            "administradores",
            adminResult[0],
            code,
            email,
            res,
            "administradores"
          );
        }

        // Buscar en la tabla de empleados
        db.query(findEmployeeSql, [email], (err, employeeResult) => {
          if (err) {
            console.error("Error al buscar en la tabla de empleados:", err);
            return res
              .status(500)
              .json({
                message: "Error en el servidor al buscar en empleados.",
              });
          }

          if (employeeResult.length > 0) {
            // Verificar el código para empleados
            return handleCodeVerification(
              "empleados",
              employeeResult[0],
              code,
              email,
              res,
              "empleados"
            );
          }

          // Usuario no encontrado en ninguna tabla
          return res
            .status(404)
            .json({
              message:
                "Usuario no encontrado en pacientes, administradores ni empleados.",
            });
        });
      });
    });
  } catch (error) {
    console.error("Error general en el servidor:", error);
    res.status(500).json({ message: "Error en el servidor." });
  }
});

// Función para verificar el código
function handleCodeVerification(
  userType,
  user,
  code,
  email,
  res,
  userTypeResponse
) {
  if (user.token_verificacion !== code) {
    return res.status(400).json({ message: "Código incorrecto." });
  }

  if (new Date() > new Date(user.token_expiracion)) {
    return res.status(400).json({ message: "El código ha expirado." });
  }

  // Limpiar el token de la base de datos
  const clearCodeSql = `
        UPDATE ${userType}
        SET token_verificacion = NULL, token_expiracion = NULL
        WHERE email = ?
    `;

  db.query(clearCodeSql, [email], (err) => {
    if (err) {
      console.error(`Error al limpiar el token en ${userType}:`, err);
      return res
        .status(500)
        .json({ message: "Error al limpiar el token de verificación." });
    }

    // Agregar depuración y responder con tipo de usuario
    console.log(
      `Código verificado correctamente para el usuario: ${email}, tipo: ${userTypeResponse}`
    );
    res.status(200).json({
      message: "Código verificado correctamente.",
      userType: userTypeResponse, // Asegurar envío del tipo de usuario
    });
  });
}

module.exports = router;
