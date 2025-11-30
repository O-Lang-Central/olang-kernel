Workflow "Smart Factory Alert" with sensor_id, threshold
  Step 1: Read temperature from {sensor_id} using SensorReader
           Save as reading
  Step 2: Ask Groq to "Is temperature {reading.value} above threshold {threshold}? Respond YES/NO"
           Save as is_over
  Step 3: If {is_over} equals "YES", Notify ops-team using Notifier with "ALERT: Sensor {sensor_jd} at {reading.value}°C"
           Save as alert_status
  Return reading.value, alert_status