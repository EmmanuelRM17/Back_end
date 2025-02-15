import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import TextField from '@mui/material/TextField';
import { Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, MenuItem, Select, InputLabel, FormControl } from '@mui/material';
import { Visibility } from '@mui/icons-material';  // Ícono de ojo
import axios from 'axios';

const ExpedienteClinico = () => {
  const location = useLocation();
  const { id, nombre, telefono, correo } = location.state || {};

  const [hoveredRow, setHoveredRow] = useState(null);
  const [filters, setFilters] = useState({ servicio: '', fecha: '' });
  const [historial, setHistorial] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Obtener historial desde la API
  useEffect(() => {
    const fetchHistorial = async () => {
      try {
        const response = await axios.get(`https://back-end-4803.onrender.com/api/expediente/paciente/${id}`);
        setHistorial(response.data);
        setLoading(false);
      } catch (err) {
        setError('Error al cargar los datos');
        setLoading(false);
      }
    };

    if (id) {
      fetchHistorial();
    }
  }, [id]);

  // Función para visualizar expediente
  const visualizarExpediente = (expedienteId) => {
    console.log(`Visualizando expediente con ID: ${expedienteId}`);
    // Aquí puedes agregar la lógica para abrir un modal o redirigir a otra página
  };

  // Función para filtrar los datos
  const applyFilters = () => {
    let filteredData = historial.filter((item) => {
      const servicioMatch = item.servicio.toLowerCase().includes(filters.servicio.toLowerCase());
      const fechaMatch = item.fecha.includes(filters.fecha);
      return servicioMatch && fechaMatch;
    });

    // Ordenar por fecha según el filtro seleccionado
    if (filters.fecha === 'másReciente') {
      filteredData = filteredData.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    } else if (filters.fecha === 'másAntiguo') {
      filteredData = filteredData.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    }

    return filteredData;
  };

  return (
    <div style={{ marginTop: '80px' }}>
      <h2 style={{ color: '#003366', textAlign: 'center' }}>Expediente Clínico</h2>

      <form style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
        <TextField label="Nombre Completo" value={nombre || 'No disponible'} disabled style={{ marginRight: '10px', width: '300px' }} />
        <TextField label="Correo" value={correo || 'No disponible'} disabled style={{ marginRight: '10px', width: '300px' }} />
        <TextField label="Teléfono" value={telefono || 'No disponible'} disabled style={{ width: '300px' }} />
      </form>

      <h3 style={{ textAlign: 'center' }}>Historial de Expediente Clínico</h3>

      {/* Filtros */}
      <div style={{ marginBottom: '10px', display: 'flex', justifyContent: 'flex-start', marginLeft: '20px' }}>
        <TextField label="Filtrar por Servicio" value={filters.servicio} onChange={(e) => setFilters({ ...filters, servicio: e.target.value })} style={{ width: '300px', marginRight: '10px' }} />
        <FormControl style={{ width: '300px' }}>
          <InputLabel>Filtrar por Fecha</InputLabel>
          <Select value={filters.fecha} onChange={(e) => setFilters({ ...filters, fecha: e.target.value })} label="Filtrar por Fecha">
            <MenuItem value="">Seleccionar</MenuItem>
            <MenuItem value="másReciente">Más reciente</MenuItem>
            <MenuItem value="másAntiguo">Más antiguo</MenuItem>
          </Select>
        </FormControl>
      </div>

      {loading ? (
        <p style={{ textAlign: 'center' }}>Cargando datos...</p>
      ) : error ? (
        <p style={{ textAlign: 'center', color: 'red' }}>{error}</p>
      ) : (
        <TableContainer style={{ maxWidth: '80%', margin: 'auto', boxShadow: '0 4px 8px rgba(0,0,0,0.1)', borderRadius: '8px' }}>
          <Table>
            <TableHead style={{ backgroundColor: '#e0f7fa' }}>
              <TableRow>
                <TableCell><strong>Fecha</strong></TableCell>
                <TableCell><strong>Servicio</strong></TableCell>
                <TableCell><strong>Descripción</strong></TableCell>
                <TableCell><strong>Acciones</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {applyFilters().map((item) => (
                <TableRow key={item.id} onMouseEnter={() => setHoveredRow(item.id)} onMouseLeave={() => setHoveredRow(null)} style={{ backgroundColor: hoveredRow === item.id ? '#b3e5fc' : 'transparent' }}>
                  <TableCell>{item.fecha}</TableCell>
                  <TableCell>{item.servicio}</TableCell>
                  <TableCell>{item.descripcion}</TableCell>
                  <TableCell>
                    <Button variant="contained" startIcon={<Visibility />} onClick={() => visualizarExpediente(item.id)} title="Ver expediente" style={{ textTransform: 'none' }} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </div>
  );
};

export default ExpedienteClinico;
