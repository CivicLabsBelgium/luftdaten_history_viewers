import React from 'react'
import DatePicker from 'react-datepicker'
import { format, startOfDay, addDays, eachDayOfInterval, addHours } from 'date-fns'
import '../node_modules/react-vis/dist/style.css'
import {XYPlot, MarkSeries, LineSeries, AreaSeries, XAxis, YAxis} from 'react-vis'
import {Map, View} from 'ol'
import '../node_modules/ol-ext/dist/ol-ext.css'
import {Fill, Style, Stroke, Circle} from 'ol/style'
import {Vector as VectorLayer, Tile as TileLayer} from 'ol/layer'
import VectorSource from 'ol/source/Vector'
import XYZ from 'ol/source/XYZ'
import {fromLonLat, transformExtent} from 'ol/proj'
import tinygradient from 'tinygradient'
import Select from 'ol/interaction/Select.js'
import * as turf from '@turf/turf'
import GeoJSON from 'ol/format/GeoJSON'

import cityList from './devData/cityList'

let map

class HotspotApp extends React.Component {
    constructor () {
        super()
        this.state = {
          dates: ['2019-04-04'],
          phenomenom: 'PM25',
          phenomena: ['PM25', 'PM10'],
          interval: 1000 * 60 * 30,
          start: Date.parse(startOfDay(new Date('2019-04-04'))),
          availableCities: [],
          dots:[],
          means: [],
          stdDeviation: [],
          highlightedDots: []
        }

        this.outlierCleanUp = this.outlierCleanUp.bind(this)
        this.highlightSensor = this.highlightSensor.bind(this)
        this.highlightSensors = this.highlightSensors.bind(this)
        this.removeHighlight = this.removeHighlight.bind(this)
        this.zoomToCity = this.zoomToCity.bind(this)
        this.getAvailableDates = this.getAvailableDates.bind(this)
    }
    componentDidMount() {
        this.getCityData()
        this.setMap()
        this.getAvailableDates()
    }
    getCityData() {
    
        let availableCities = cityList.data
            availableCities = availableCities.filter(city => city.data.length > 10 && city.tiles.length > 0)
            availableCities = availableCities.sort((a,b) => {
                const nameA = a.name.toUpperCase(); // ignore upper and lowercase
                const nameB = b.name.toUpperCase(); // ignore upper and lowercase
                if (nameA < nameB) {
                    return -1;
                }
                if (nameA > nameB) {
                    return 1;
                }

                // names must be equal
                return 0;
            } )
            this.setState({
                availableCities,
                city: availableCities[0]
            })
        return
        // eslint-disable-next-line no-unreachable
        fetch(`https://data.influencair.be/cityList.json`).then(response => {
            return response.json()
        }).then(json => {
            let availableCities = json.data
            availableCities= availableCities.filter(city => city.data.length > 10 && city.tiles.length > 0)
            this.setState({
                availableCities
            })
        })
    }
    setCity (city) {
        const cityObj = this.state.availableCities.find( cObj => cObj.name === city)
        this.setState({
            city: cityObj
        })
    }
    setStartDate(date) {
        const start = Date.parse(startOfDay(date))
        this.setState({
            start
        })
    }
    getAvailableDates () {
        const url = `https://history.influencair.be/availableDays`
        fetch(url)
          .then(response => {
            return response.json()
          })
          .then(myJson => {
            const availableDays = myJson.map(day => Date.parse(day))
            this.setState({
              availableDays
            })
            this.setStartDate(availableDays[availableDays.length - 1])
          })
    }
    async getData() {
        const promises = this.state.city.tiles.map(position => fetch(`https://history.influencair.be/${this.state.phenomenom}/${position}/${format(this.state.start, 'yyyy-MM-dd')}/data.json`).then(response => {
          if (response.status === 200) {
            return response.json()
          } else {
            return []
          }
        }))
        let results = await Promise.all(promises)
        const citySensors = [...results.flat()].filter(sensor =>  this.state.city.data.includes(sensor.location.id))
        const restSensors = [...results.flat()].filter(sensor =>  !this.state.city.data.includes(sensor.location.id)).map(sensor => {
            delete sensor.timeserie
            return sensor
        })
        this.setState({
            sensors: citySensors,
            restSensors, 
            highlightedDots: []
        })
        this.zoomToCity(citySensors)
        this.parseData()
    }
    outlierCleanUp (dots) {
        // We're going to use Chauvenet's criterion
        // https://en.wikipedia.org/wiki/Chauvenet%27s_criterion
        const day = 1000 * 60 * 60 * 24
        const start = this.state.start
        const interval = this.state.interval
        const end = this.state.start + day
        const groupedFrames = {}
        for (let time = start; time < end; ) {
            const endTime = time + interval
            const frame = []
            while (dots[0] && dots[0].x < endTime) {
                if (dots[0].x > time) frame.push(dots.shift())
                dots.shift()
            }
            if (frame.length > 0) {
                const mean = frame.reduce((acc, dot) => {
                    return acc + dot.y
                }, 0) / frame.length
    
                const squareDiffs = frame.map(dot =>{
                    const diff = dot.y - mean
                    const sqrDiff = diff * diff
                    return sqrDiff
                })
                
                const avgSquareDiff = squareDiffs.reduce((acc, value) => {
                    return acc + value
                },0) / squareDiffs.length
    
                const standardDeviation = Math.sqrt(avgSquareDiff)

                const cleanFrame = frame.reduce((acc, dot, index) => {
                    const value = dot.y
                    const dividend = Math.E ** -((value - mean) ** 2 / (2 * standardDeviation ** 2))
                    const divisor = standardDeviation * Math.sqrt(2 * Math.PI);
                    const probability =  dividend / divisor
                    if (probability * frame.length > 0.1) { 
                        acc.push(dot)
                    } else {
                        // nothing happens
                    }
                    return acc
                }, [])
                groupedFrames[time] = cleanFrame
            }
            time = endTime
        }
        return groupedFrames
    }
    parseData() {
        const sensors = this.state.sensors
        const interval = this.state.interval
        let dots = []

        for (const sensor of sensors) {
            for (const timeLog of sensor.timeserie) {
                dots.push({
                    x: Date.parse(timeLog[0]),
                    y: timeLog[1] > 500 ? 500 : timeLog[1], // cap to 500
                    s: sensor.id
                })
            }
        }
        dots.sort((a,b) => a.x - b.x)

        const groupedPerInterval = this.outlierCleanUp(dots)
        console.log(groupedPerInterval)
        const means = []
        const stdDeviation = []
        for (const time in groupedPerInterval) {
            if (groupedPerInterval[time].length) {
                const mean = groupedPerInterval[time].reduce((acc, dot) => {
                    return acc + dot.y
                }, 0)/ groupedPerInterval[time].length
                const squareDiffs = groupedPerInterval[time].map(dot =>{
                    const diff = dot.y - mean
                    const sqrDiff = diff * diff
                    return sqrDiff
                })
                
                const avgSquareDiff = squareDiffs.reduce((acc, value) => {
                    return acc + value
                },0) / squareDiffs.length
    
                const standardDeviation = Math.sqrt(avgSquareDiff)
    
                stdDeviation.push({
                    x: parseInt(time),
                    y: mean + (standardDeviation),
                    y0: mean - (standardDeviation)
                })
    
                means.push({
                    x: parseInt(time),
                    y: mean
                })

                dots.push(...groupedPerInterval[time])
            }
        }

        const sensorWeight = {}

        for (const stdDev of stdDeviation) {
            const mean = (stdDev.y - stdDev.y0) / 2
            for (const dot of dots) {
                if (dot.x > stdDev.x && dot.x < stdDev.x + interval) {
                    dot.color = dot.y > stdDev.y || dot.y < stdDev.y0 ? '#ff562f' : '#74b6e6'
                    sensorWeight[dot.s] = sensorWeight[dot.s] || [] // if array keep array else create array
                    sensorWeight[dot.s].push((dot.y - stdDev.y0 + mean) / stdDev.y)
                }
            }
        }

        const points = []
        for (const sensorId in sensorWeight) {
            if (sensorWeight.hasOwnProperty(sensorId)) {
                const sensor = sensorWeight[sensorId];
                const weightMean = sensor.reduce((acc, dot) => acc + dot, 0) / sensor.length
                const location = sensors.find(sensor => sensor.id === parseInt(sensorId)).location
                points.push(turf.point(fromLonLat([location.longitude, location.latitude]), {id: parseInt(sensorId), weightMean}))
            }
        }

        for (const sensor of this.state.restSensors) {
            const location = sensor.location
            points.push(turf.point(fromLonLat([location.longitude, location.latitude]), {id: parseInt(sensor.id)}))
        }
        

        const bounds = map.getView().calculateExtent(map.getSize())
        const pointCollection = turf.featureCollection(points)
        const voronoi = turf.voronoi(pointCollection, {bbox: bounds})
        
        voronoi.features = voronoi.features.map((f,i) => {
            f.properties = points[i].properties
            return f
        }).filter(Boolean)

        console.log(voronoi)

        const vectorSource = new VectorSource({
            features: (new GeoJSON()).readFeatures(voronoi)
        })

        const gradient = tinygradient(["#2c7bb6", "#00a6ca","#00ccbc","#90eb9d","#ffff8c",
        "#f9d057","#f29e2e","#e76818","#d7191c"])
    
        const vectorLayer = new VectorLayer({
            source: vectorSource,
            name: 'timeSerie',
            opacity: 0.4,
            style: feature => {
                let mean = feature.get('weightMean')
                if(mean) {
                    mean = mean < 0 ? 0 : (mean > 1 ? 1 : mean)
                    return new Style({
                        fill: new Fill({
                            color: gradient.rgbAt(mean)
                        })
                    })
                } else {
                    return new Style()
                }
            }
        })

            console.log(pointCollection)
        const pointSource = new VectorSource({
            features: (new GeoJSON()).readFeatures(pointCollection)
        })
        console.log(pointSource)
        const pointLayer = new VectorLayer({
            source: pointSource,
            name: 'points',
            opacity: 1,
            style: new Style({
                image: new Circle({
                    radius: 3,
                    stroke: new Stroke({
                        color: '#101010', 
                        width: 1
                    }),
                    fill: new Fill({
                        color: '#303030'
                    })
                })
            })
        })
        const mapLayers = map.getLayers().getArray()
        mapLayers.forEach(layer => {
            console.log(layer)
            if (layer.type === 'VECTOR') map.removeLayer(layer)
        })
        

        map.addLayer(pointLayer)
        map.addLayer(vectorLayer)

        this.setState({
            means,
            stdDeviation,
            dots
        })
    }
    highlightSensor (datapoint, event) {
        const sensor = this.state.sensors.find(sensor => datapoint.s === sensor.id)
        const highlightedDots = [this.state.dots.filter(dot => datapoint.s === dot.s)]
        this.setState({
            highlightedDots
        })
    }
    highlightSensors (sensorIds) {
        const highlightedDots = sensorIds.map(sensorId => {
            return this.state.dots.filter(dot => sensorId === dot.s)
        })
        this.setState({
            highlightedDots
        })
    }
    removeHighlight () {
        this.setState({
            highlightedDots: []
        })
    }
    setMap() {
        const pos = this.state.position
        map = new Map({
          target: 'map',
          renderer: 'webgl',
          layers: [
            new TileLayer({
                source: new XYZ({
                    url: 'https://api.mapbox.com/styles/v1/appsaloon/cj3tqlivy00002sq88o3vzsgr/tiles/256/{z}/{x}/{y}?access_token=pk.eyJ1IjoiYXBwc2Fsb29uIiwiYSI6ImNpaGMwN2p2ZTEweHN2MGtpMm5lNnkxcmQifQ.vNd3He7Merax-vnWQS_ZTQ'
                })
            })
          ]
        })
        map.setView(new View({
          center: fromLonLat([3, 51]),
          maxResolution: 5000,
          minResolution: 4.5,
          resolution: 1000
        }))
        const select = new Select()
        map.addInteraction(select)
        select.on('select', (e) => {
            const features = e.target.getFeatures().getArray()
            console.log(features)
            if (!features || !features.length) return
            const sensorIds = features.map(feature => {
                return feature.get('id')
            })
            console.log(sensorIds)
            if (sensorIds) {
                this.highlightSensors(sensorIds)
            } else {
                this.removeHighlight()
            }
            
        })
    }
    zoomToCity (sensors) {
        // get min max lat lng
        const lat = []
        const lng = []
        for (const sensor of sensors) {
            lat.push(sensor.location.latitude)
            lng.push(sensor.location.longitude)
        }
        const extend = transformExtent([Math.min(...lng), Math.max(...lat), Math.max(...lng), Math.min(...lat)], 'EPSG:4326', 'EPSG:3857')
        map.getView().fit(extend, map.getSize())
    }
    render () {
        const state = this.state
        return (
            <div style={{
              width: 800,
              margin: '0 auto',
              position: 'relative'
            }}>
              <h3 style={{
                backgroundColor: '#2b2b2b',
                color: '#f6f3ef',
                margin: 0,
                padding: '8px 16px',
              }}>Historic luftdaten hotspot finder</h3>
              <div className="form row">
                <div className="column">
                <label>City <select defaultValue={this.state.city ? this.state.city.name : null} onChange={((e) => {this.setCity(e.target.value)})}>
                    {this.state.availableCities.map(city => {
                        return (
                            <option key={city.name} value={city.name}>{city.name}</option>
                        )
                    })}
                    </select>
                  </label>
                  <label>
                    Date: <DatePicker
                    selected={state.start}
                    onChange={(e) => this.setStartDate(e)}
                    selectsStart
                    includeDates={state.availableDays}
                    dateFormat="yyyy-MM-dd"
                  />
                  </label>
                  <label>Phenomenom <select defaultValue={this.state.phenomenom} onChange={((e) => {this.setState({phenomenom: e.target.value})})}>
                      <option value='PM25'>PM2.5</option>
                      <option value='PM10'>PM10</option>
                    </select>
                  </label>
                  <button onClick={() => this.getData()}>Get data</button>
                </div>
                <div className="column">
                </div>
              </div>
              <div style={{width:800, backgroundColor: 'white'}}>
                <XYPlot height={400} width={790} colorType="literal">
                    <XAxis 
                        tickTotal={12}
                        tickFormat={value => {
                            return format(value, 'HH:MM')
                        }}/>
                    <YAxis />
                    {/* <MarkSeries
                        className="mark-series-example"
                        data={this.state.dots}
                        opacity={0.3}
                        size={3}
                        strokeWidth={1}
                        /> */}
                    <AreaSeries
                        data={this.state.stdDeviation}
                        style={{strokeDasharray: "2 2"}}
                        opacity={0.5}
                        />
                    <LineSeries
                        color="red"
                        data={this.state.means}
                        />
                    {this.state.highlightedDots.map(line => {
                        return (
                            <LineSeries
                                color="green"
                                data={line}
                            />
                        )
                    })}
                </XYPlot>
                </div>
                    <div id='map' style={{
                        width: 792,
                        height: 500,
                        border: '4px solid #2b2b2b'
                    }}>
                </div>
            </div>
          )
    }
} 

export default HotspotApp;
