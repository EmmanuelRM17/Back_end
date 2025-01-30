const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const app = express();

// Middleware esencial para cookies
app.use(cookieParser());

// Configuración CORS esencial para cookies
app.use(cors({
  origin: [
    "https://odontologiacarol.onrender.com",
    "https://odontologiacarol.isoftuthh.com",
    "http://localhost:3000",
    "http://localhost:3001"
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["Set-Cookie"] 
}));

// Configuración básica de seguridad con Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://www.google.com", "https://www.gstatic.com"],
      frameSrc: ["'self'", "https://www.google.com", "https://www.recaptcha.net"],
      imgSrc: ["'self'", "https://www.google.com", "https://www.gstatic.com"],
      connectSrc: [
        "'self'",
        "https://odontologiacarol.onrender.com",
        "https://odontologiacarol.isoftuthh.com",
        "http://localhost:3000",
        "http://localhost:3001"
      ]
    }
  }
}));

// Middlewares básicos
app.use(bodyParser.json());
app.use(express.json());


// Tus rutas existentes
const userRoutes = require("./routes/userRoutes");
const Registrer = require("./routes/registrer");
const politicasRoutes = require("./routes/inf_politicasRoutes.js");
const deslindeRoutes = require("./routes/inf_deslindelegal.js");
const terminosRoutes = require("./routes/inf_terminosYcondicion.js");
const perfil_empresa = require("./routes/inf_perfilEmpresa.js");
const reportes = require("./routes/inf_reportes.js");
const redes = require("./routes/inf_redessociales.js");
const perfil_paciente = require("./routes/perfil_paciente.js");

// Asignar rutas
app.use("/api", Registrer);
app.use("/api/users", userRoutes);

//administrador
app.use("/api/politicas", politicasRoutes);
app.use("/api/deslinde", deslindeRoutes);
app.use("/api/termiCondicion", terminosRoutes);
app.use("/api/perfilEmpresa", perfil_empresa);
app.use("/api/reportes", reportes);
app.use("/api/redesSociales", redes);

//pacientes
app.use("/api/profile", perfil_paciente);

app.listen(3001, () => {
  console.log("Servidor corriendo en puerto 3001");
});
