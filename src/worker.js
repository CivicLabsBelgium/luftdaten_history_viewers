export default () => {
    const parseSensors = e => {
        if (!e || !e.data.sensors || !e.data.amountOfLayers) return

        const {amountOfLayers, interval, start} = e.data
        let {sensors, time, tillTime} = e.data
        const geoJsonObject = {
            type: 'FeatureCollection',
            features: []
        }

        console.log('optimize timeSeries')
        sensors = sensors.map(sensor => {
        sensor.timeserie.map(timelog => {
            timelog[0] = Date.parse(timelog[0])
            return timelog
        })
        return sensor
        })

        console.log('parsing')
        for (let index = 0; index < sensors.length; index++) {
            const sensor = sensors[index]
            const timeSerie = sensor.timeserie
            const parsingProgress = index / sensors.length
            const feature = {
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: sensor.coordinates
                },
                properties: {
                    values: {},
                    id: sensor.id
                }
            }
            if (index % 10 === 0) postMessage({parsingProgress})
            for (let timeMultiplier = 0; timeMultiplier < amountOfLayers; timeMultiplier++) {
                time = start + (timeMultiplier * interval)
                tillTime = time + interval
                const data = []
                while(timeSerie[0] && timeSerie[0][0] < tillTime) {
                    if (timeSerie[0][0] > time) data.push(timeSerie.shift())
                    timeSerie.shift()
                }
                const value = (data.reduce((acc, t) => {
                acc = acc + t[1]
                return acc
                }, 0))/data.length

                if (!isNaN(value)) {
                feature.properties.values[time] = value
                
                }
            }
            geoJsonObject.features.push(feature) 
        }

        postMessage({geoJsonObject});
    }
    self.addEventListener('message', parseSensors) // eslint-disable-line no-restricted-globals
}