#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import sys
import json
import joblib
import numpy as np
from pathlib import Path

def load_models():
    """Carga los modelos entrenados - VERSION SIMPLE"""
    try:
        model_path = Path(__file__).parent
        # Cargar modelo simple (sin funciones)
        modelo_completo = joblib.load(model_path / 'modelo_clustering_completo.pkl')
        return modelo_completo['kmeans'], modelo_completo['scaler'], modelo_completo['cluster_labels']
    except Exception as e:
        raise Exception(f"Error cargando modelos: {str(e)}")

def safe_float_conversion(value, default=0.0):
    """Convierte un valor a float de forma segura"""
    try:
        if value is None or value == '' or value == 'null':
            return default
        return float(value)
    except (ValueError, TypeError):
        return default

def preprocess_patient_data(patient_data):
    """Preprocesa los datos del paciente para el modelo"""
    # Variables que usa el modelo original
    required_features = [
        'tasa_noshow',
        'tasa_completion', 
        'citas_canceladas',
        'tasa_pago_exitoso'
    ]
    
    # Crear array con las features requeridas
    processed_data = []
    
    for feature in required_features:
        raw_value = patient_data.get(feature, 0)
        
        # Convertir a número de forma segura
        if feature == 'citas_canceladas':
            # Este es entero
            try:
                value = int(float(raw_value)) if raw_value else 0
            except:
                value = 0
        else:
            # Estos son tasas (float entre 0 y 1)
            value = safe_float_conversion(raw_value, 0.0)
            # Asegurar que las tasas estén entre 0 y 1
            if feature.startswith('tasa_'):
                value = max(0.0, min(1.0, value))
            
        processed_data.append(float(value))
    
    return np.array(processed_data).reshape(1, -1)

def classify_patient(patient_data):
    """Clasifica un paciente en su segmento correspondiente"""
    try:
        # Debug: mostrar datos recibidos
        print(f"DEBUG: Datos recibidos: {patient_data}", file=sys.stderr)
        
        # Cargar modelos
        kmeans, scaler, cluster_labels = load_models()
        
        # Preprocesar datos
        features = preprocess_patient_data(patient_data)
        print(f"DEBUG: Features procesadas: {features}", file=sys.stderr)
        
        # Escalar features
        features_scaled = scaler.transform(features)
        print(f"DEBUG: Features escaladas: {features_scaled}", file=sys.stderr)
        
        # Predecir cluster
        cluster = kmeans.predict(features_scaled)[0]
        print(f"DEBUG: Cluster predicho: {cluster}", file=sys.stderr)
        
        # Obtener segmento usando el mapeo cargado
        segmento = cluster_labels.get(cluster, 'DESCONOCIDO')
        
        # Obtener distancias para confianza
        distances = kmeans.transform(features_scaled)[0]
        confidence = 1 - (min(distances) / max(distances)) if max(distances) > 0 else 1
        
        result = {
            'success': True,
            'cluster': int(cluster),
            'segmento': segmento,
            'confidence': round(float(confidence), 3),
            'patient_id': patient_data.get('paciente_id', 'N/A')
        }
        
        print(f"DEBUG: Resultado final: {result}", file=sys.stderr)
        return result
        
    except Exception as e:
        error_msg = f"Error en clasificación: {str(e)}"
        print(f"DEBUG: {error_msg}", file=sys.stderr)
        return {
            'success': False,
            'error': error_msg,
            'patient_id': patient_data.get('paciente_id', 'N/A')
        }

def main():
    """Función principal"""
    try:
        if len(sys.argv) != 2:
            raise ValueError("Se requiere exactamente un argumento con los datos del paciente")
        
        # Parsear datos de entrada
        patient_data = json.loads(sys.argv[1])
        print(f"DEBUG: Datos parseados: {patient_data}", file=sys.stderr)
        
        # Clasificar paciente
        result = classify_patient(patient_data)
        
        # Retornar resultado como JSON
        print(json.dumps(result, ensure_ascii=False))
        
    except json.JSONDecodeError as e:
        error_result = {
            'success': False,
            'error': f"Error parseando JSON: {str(e)}"
        }
        print(json.dumps(error_result, ensure_ascii=False))
        sys.exit(1)
    except Exception as e:
        error_result = {
            'success': False,
            'error': f"Error en script Python: {str(e)}"
        }
        print(json.dumps(error_result, ensure_ascii=False))
        sys.exit(1)

if __name__ == "__main__":
    main()