#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import sys
import json
import joblib
import numpy as np
import pandas as pd
from pathlib import Path

def load_models():
    """Carga los modelos entrenados"""
    try:
        model_path = Path(__file__).parent
        kmeans = joblib.load(model_path / 'modelo_clustering_kmeans.pkl')
        scaler = joblib.load(model_path / 'scaler_clustering.pkl')
        return kmeans, scaler
    except Exception as e:
        raise Exception(f"Error cargando modelos: {str(e)}")

def preprocess_patient_data(patient_data):
    """Preprocesa los datos del paciente para el modelo"""
    # Variables importantes del modelo (las 8 seleccionadas)
    required_features = [
        'gasto_total_citas',
        'ticket_promedio', 
        'precio_maximo',
        'citas_canceladas',
        'tratamientos_activos',
        'citas_pendientes_pago',
        'valor_tratamiento_promedio',
        'tasa_noshow'
    ]
    
    # Crear DataFrame con las features requeridas
    processed_data = []
    for feature in required_features:
        valor = patient_data.get(feature, 0)
        
        # Aplicar transformaciones logarítmicas como en el entrenamiento
        if feature in ['gasto_total_citas', 'ticket_promedio']:
            valor = np.log1p(float(valor)) if valor > 0 else 0
        else:
            valor = float(valor)
            
        processed_data.append(valor)
    
    return np.array(processed_data).reshape(1, -1)

def classify_patient(patient_data):
    """Clasifica un paciente en su segmento correspondiente"""
    try:
        # Cargar modelos
        kmeans, scaler = load_models()
        
        # Preprocesar datos
        features = preprocess_patient_data(patient_data)
        
        # Escalar features
        features_scaled = scaler.transform(features)
        
        # Predecir cluster
        cluster = kmeans.predict(features_scaled)[0]
        
        # Mapeo de clusters a segmentos
        segment_mapping = {
            0: 'VIP',
            1: 'REGULARES', 
            2: 'PROBLEMÁTICOS'
        }
        
        # Obtener probabilidades/distancias para confianza
        distances = kmeans.transform(features_scaled)[0]
        confidence = 1 - (min(distances) / max(distances)) if max(distances) > 0 else 1
        
        return {
            'success': True,
            'cluster': int(cluster),
            'segmento': segment_mapping.get(cluster, 'DESCONOCIDO'),
            'confidence': round(confidence, 3),
            'patient_id': patient_data.get('paciente_id', 'N/A')
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': str(e),
            'patient_id': patient_data.get('paciente_id', 'N/A')
        }

def main():
    """Función principal"""
    try:
        if len(sys.argv) != 2:
            raise ValueError("Se requiere exactamente un argumento con los datos del paciente")
        
        # Parsear datos de entrada
        patient_data = json.loads(sys.argv[1])
        
        # Clasificar paciente
        result = classify_patient(patient_data)
        
        # Retornar resultado como JSON
        print(json.dumps(result, ensure_ascii=False))
        
    except Exception as e:
        error_result = {
            'success': False,
            'error': f"Error en script Python: {str(e)}"
        }
        print(json.dumps(error_result, ensure_ascii=False))
        sys.exit(1)

if __name__ == "__main__":
    main()