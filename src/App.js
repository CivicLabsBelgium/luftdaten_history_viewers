import React from 'react'
import {Map, View} from 'ol'
import TileLayer from 'ol/layer/Tile'
import XYZ from 'ol/source/XYZ'
import {fromLonLat, transformExtent} from 'ol/proj'
import {Fill, Style} from 'ol/style'
import {Vector as VectorLayer} from 'ol/layer.js'
import {Vector as VectorSource} from 'ol/source'
import Hexbin from 'ol-ext/source/HexBin'
import { format, startOfDay, addDays, eachDayOfInterval, addHours } from 'date-fns'
import DatePicker from 'react-datepicker'
import PlayerBar from './PlayerBar'
import SunCalc from 'suncalc'
import WebWorker from './WebWorker'
import dataParseWorker from './worker'
import GeoJSON from 'ol/format/GeoJSON'

import "react-datepicker/dist/react-datepicker.css"
import "./App.css"


let map

const colours =  [
  {color: '#70AE6E', value: 0, style: new Style({
    fill: new Fill({
      color: '#70AE6E'
    })
  })},
  {color: '#70AE6E', value: 20, style: new Style({
    fill: new Fill({
      color: '#70AE6E'
    })
  })},
  {color: '#E5C038', value: 35, style: new Style({
    fill: new Fill({
      color: '#E5C038'
    })
  })},
  {color: '#ea8b00', value: 50, style: new Style({
    fill: new Fill({
      color: '#ea8b00'
    })
  })},
  {color: '#d8572a', value: 100, style: new Style({
    fill: new Fill({
      color: '#d8572a'
    })
  })},
  {color: '#c32f27', value: 1200, style: new Style({
    fill: new Fill({
      color: '#c32f27'
    })
  })}
]

const getStyleForMean = (meanValue) => {
  return colours.find((data) => data.value >= meanValue) || colours[colours.length - 1]
}

class App extends React.Component {
  constructor () {
    super()
    this.state = {
      data: [],
      dates: ['2019-04-04'],
      map: {},
      phenomenom: 'PM25',
      phenomena: ['PM25', 'PM10'],
      layers: {},
      interval: 1000 * 60 * 30,
      start: Date.parse(startOfDay(new Date('2019-04-04'))),
      time: Date.parse(startOfDay(new Date('2019-04-04'))),
      end: Date.parse(startOfDay(new Date('2019-04-04'))) + (1000 * 60 * 60 * 24) - 1,
      framesPerSecond: 5,
      parsingProgress: 0,
      latlng: [],
      position: [51, 4],
      stopPlayer: true
    }
    this.getAvailableDates()
  }
  setTime(pos) {
    const start = this.state.start
    const end = this.state.end
    const interval = this.state.interval
    let time = start + ((end - start) * (pos / 100))
    time = time - (time % interval)
    this.setState({
      time
    })
    this.playData()
  }
  setStartDate(date) {
    const start = Date.parse(startOfDay(date))
    const end = Date.parse(startOfDay(date)) + (1000 * 60 * 60 * 24) - 1
    const dates = eachDayOfInterval({start, end}).map(date => format(date, 'yyyy-MM-dd'))
    this.setState({
      start,
      time: start,
      end,
      dates
    })
  }
  setEndDate(date) {
    const end = Date.parse(startOfDay(date)) + (1000 * 60 * 60 * 24) - 1
    const dates = eachDayOfInterval({start: this.state.start, end}).map(date => format(date, 'yyyy-MM-dd'))
    this.setState({
      end ,
      dates
    })
  }
  getAvailableDates () {
    const url = `https://history.influencair.be/availableDays`
    fetch(url)
      .then(response => {
        return response.json()
      })
      .then(myJson => {
        this.setState({
          availableDays: myJson.map(day => Date.parse(day))
        })
        this.prepareLayers()
      })
  }
  setPosition(position) {
    this.setState({
      position
    })
  }
  getDataForDate (date) {
    const phenomenom = this.state.phenomenom
    return new Promise((resolve, reject) => {
      const promises = this.state.luftdatenTiles.map(position => fetch(`https://history.influencair.be/${phenomenom}/${position}/${date}/data.json`).then(response => {
        if (response.status === 200) {
          return response.json()
        } else {
          return []
        }
      }))
      Promise.all(promises).then(results => {
        resolve(results.flat())
      })
    })
  }
  async getData (){
    this.setState({
      stopPlayer: true,
      data: [],
      layers: new Map()
    })
    let data =  []
    const dates = this.state.dates
    
    for (let index = 0; index < dates.length; index++) {
      const date = dates[index];
      const newData = await this.getDataForDate(date)
      if (data.length === 0) {
        data = newData
      } else {
        data = this.mergeDataDays(data, newData)
      }
    }
    console.log('Fetched sensors: ', data.length)
    this.setState({
      data: data
    })
    this.parseData()
    
  }
  mergeDataDays (oldData, newData) {
    while (newData.length > 0) {
      const sensor = newData.shift()
      const index = oldData.findIndex((oldSensor) => oldSensor.id === sensor.id)
      if (index > -1) {
        const oldSensor = oldData[index]
        oldSensor.timeserie = oldSensor.timeserie.concat(sensor.timeserie)
        oldData[index] = oldSensor
      } else {
        oldData.push(sensor)
      }
    }
    return oldData
  }
  setMap() {
    const pos = this.state.position
    map = new Map({
      target: 'map',
      layers: [
        new TileLayer({
          source: new XYZ({
            //url: 'https://maps.luftdaten.info/tiles/{z}/{x}/{y}.png',
            //url: 'https://api.tiles.mapbox.com/v4/mapbox.streets/{z}/{x}/{y}.png?access_token=pk.eyJ1IjoiYXBwc2Fsb29uIiwiYSI6ImNpaGMwN2p2ZTEweHN2MGtpMm5lNnkxcmQifQ.vNd3He7Merax-vnWQS_ZTQ'
            url: 'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'
            //url: 'https://tiles.wmflabs.org/bw-mapnik/{z}/{x}/{y}.png'
          })
        })
      ]
    })
    map.setView(new View({
      center: fromLonLat([pos[1], pos[0]]),
      maxResolution: 5000,
      minResolution: 4.5,
      resolution: 160
    }))
    this.setState({map})
    map.on('moveend', () => {
      const bounds = map.getView().calculateExtent(map.getSize())
      const box = transformExtent(bounds,'EPSG:3857','EPSG:4326')
      const minLng = Math.floor(box[0])
      const maxLng = Math.floor(box[2])
      const minLat = Math.floor(box[1])
      const maxLat = Math.floor(box[3])
      const luftdatenTiles = []
      for (let lng = minLng; lng <= maxLng; lng++) {
        for (let lat = minLat; lat <= maxLat; lat++) {
          luftdatenTiles.push(`${lat}-${lng}`)
        }
      }
      const zoomlevel = map.getView().getZoom()
      const resolution = map.getView().getResolutionForZoom(zoomlevel)
      console.log('Tiles: ',luftdatenTiles, 'Zoom: ', zoomlevel, 'resolution: ', resolution)
      const shouldRerenderHexBinning = (this.state.resolution !== resolution)
      this.setState({
        luftdatenTiles,
        mapBox: box,
        zoomlevel,
        resolution,
        position: [box[1] + ((box[3] - box[1]) / 2), box[0] + ((box[2] - box[0]) / 2)],
        hexbinSize: this.resolutionToHexbinSize(resolution)
      })
      if (shouldRerenderHexBinning) {
        console.log('prepareLayers')
        this.prepareLayers()
      }
      
    })
  }
  resolutionToHexbinSize (resolution) {
    const minSize = [4.5, 40]
    const maxSize = [300, 7000]
    return (((maxSize[1] - minSize[1]) / (maxSize[0] - minSize[0])) * (resolution - minSize[0])) + minSize[1]
  }
  parseData () {
    const state = this.state
    let sensors = state.data
    if (!sensors || sensors.length === 0) return

    sensors = sensors.map(sensor => {
      sensor.coordinates = fromLonLat([sensor.location.longitude, sensor.location.latitude])
      return sensor
    })
    
    const duration = state.end - state.start
    const amountOfLayers = duration / state.interval
    let time = state.start
    let tillTime = state.start + state.interval

    this.worker.postMessage({
      sensors,
      amountOfLayers,
      time,
      tillTime,
      start: state.start,
      interval: state.interval
    })

    this.setState({
      parsing: true
    })

    // const vectorSource = []
    // for (let timeMultiplier = 0; timeMultiplier < amountOfLayers; timeMultiplier++) {
    //   vectorSource[timeMultiplier] = new VectorSource()
    // }
    
    // console.log('optimize timeSeries')
    // sensors = sensors.map(sensor => {
    //   sensor.timeserie.map(timelog => {
    //     timelog[0] = Date.parse(timelog[0])
    //     return timelog
    //   })
    //   return sensor
    // })

    // console.log('parsing')
    // for (let index = 0; index < sensors.length; index++) {
    //   const sensor = sensors[index]
    //   const timeSerie = sensor.timeserie
      
    //   for (let timeMultiplier = 0; timeMultiplier < amountOfLayers; timeMultiplier++) {
    //     time = state.start + (timeMultiplier * state.interval)
    //     tillTime = time + state.interval
    //     const data = []
    //     while(timeSerie[0] && timeSerie[0][0] < tillTime) {
    //       if (timeSerie[0][0] > time) data.push(timeSerie.shift())
    //       timeSerie.shift()
    //     }
    //     const value = (data.reduce((acc, t) => {
    //       acc = acc + t[1]
    //       return acc
    //     }, 0))/data.length

    //     if (!isNaN(value)) {
    //       const feature = new Feature({
    //         geometry: new Point(fromLonLat([sensor.location.longitude, sensor.location.latitude])),
    //         name: sensor.id,
    //         value
    //       })
    //       vectorSource[timeMultiplier].addFeature(feature)
    //     }
    //   } 
    // }
    // this.setState({
    //   vectorSource,
    //   parsing: false,
    //   data: []
    // })
    // console.log('Data parsing done')
    // this.prepareLayers()
  }
  prepareLayers () {
    console.log('preparing layers')
    const state = this.state
    const geoJsonObject = state.geoJsonObject
    if (!geoJsonObject || (geoJsonObject && geoJsonObject.length === 0)) return

    const duration = state.end - state.start
    const amountOfLayers = duration / state.interval
    let time = state.start

    const layers = {}

    for (let timeMultiplier = 0; timeMultiplier < amountOfLayers; timeMultiplier++) {
      time = state.start + (timeMultiplier * state.interval)
      const vectorSource = new VectorSource({
        features: (new GeoJSON()).readFeatures(geoJsonObject[timeMultiplier])
      })
      const hexbin = new Hexbin({
        source: vectorSource,
        size: state.hexbinSize
      })

      const vectorLayer = new VectorLayer({
        source: hexbin,
        name: 'timeSerie',
        opacity: 0.7,
        style: feature => {
          const features = feature.get('features')
          const mean = features.map(f => {
            return f.get('value')
          })
          let value
          if (mean.length === 1) {
            value = mean[0]
          } else if (mean.length === 2) {
            value = (mean[0] + mean[1])/2
          } else {
            mean.sort()
            value = mean[parseInt(mean.length / 2)]
          }
          return getStyleForMean(value).style
        }
      })
      layers[time] = vectorLayer
    }

    this.setState({
      layers,
      parsing: false
    })
    console.log('parsing done')
    this.playData()
  }
  playData () {
    const state = this.state
    const map = state.map
    const mapLayers = map.getLayers().getArray()
    const layers = state.layers
    const timeZoneOffset = state.position[1] * 24 / 360
    const sun = SunCalc.getPosition(addHours(state.time, timeZoneOffset), state.position[0], state.position[1]).altitude
    const tileOpacity = Math.min(Math.max(0.8 + ((sun + 0.2)), 0),1)
    mapLayers[0].setOpacity(tileOpacity)
    mapLayers.forEach(layer => {
      if (layer.get('name') === 'timeSerie') map.removeLayer(layer)
    })
    const showLayer = layers[state.time]
    if (!showLayer) return
    map.addLayer(showLayer)
    const nextTime = (state.time + state.interval < state.end) ? state.time + state.interval : state.start
    if (!state.stopPlayer) {
      setTimeout(() => {
        this.setState({
          time: nextTime
        })
        this.playData()
      }, 1000 / state.framesPerSecond)
    }

  }
  componentDidMount() {
    this.setMap()
    this.worker =  new WebWorker(dataParseWorker)
    this.worker.addEventListener('message', event => {
      if (event.data.geoJsonObject) {
        this.setState({
          data: [],
          geoJsonObject: event.data.geoJsonObject
        })
        this.prepareLayers()
      }
      if (event.data.parsingProgress) {
        this.setState({
          parsingProgress: event.data.parsingProgress
        })
      }
    })
  }
  render () {
    const state = this.state
    const duration = state.end - state.start
    const width = ((state.time - state.start) / duration) * 100
    const progress = state.parsingProgress * 100
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
        }}>Historic luftdaten viewer</h3>
        <div className="form">
          <label>
            Start date: <DatePicker
            selected={state.start}
            onChange={(e) => this.setStartDate(e)}
            selectsStart
            includeDates={state.availableDays}
            dateFormat="yyyy-MM-dd"
          />
          </label>
          <label>
            End date: <DatePicker
            selected={state.end}
            onChange={(e) => this.setEndDate(e)}
            selectsEnd
            startDate={state.start}
            endDate={state.end}
            includeDates={state.availableDays}
            maxDate={addDays(state.start, 3)}
            minDate={state.start}
            dateFormat="yyyy-MM-dd"
          />
          </label>
          <label>Phenomenom <select defaultValue={this.state.phenomenom} onChange={((e) => {this.setState({phenomenom: e.target.value})})}>
              <option value='PM25'>PM2.5</option>
              <option value='PM10'>PM10</option>
            </select>
          </label>
          <button onClick={(e) => this.getData()}>Get data</button>
        </div>
        {state.parsing && progress ? 
          <div style={{
            position: 'absolute',
            bottom: 500,
            left: 4,
            width: 800,
            height: 8
          }}
          >
            <div style={{
              width: progress + '%',
              backgroundColor: 'red',
              height: 8,
              float: 'left',
            }}></div>
          </div>
        : 
          null
        }
        <div id='map' style={{
          width: 792,
          height: 500,
          border: '4px solid #2b2b2b'
        }}>
        </div>
        <PlayerBar position={width} onChange={newPos => this.setTime(newPos)}/>
        <div style={{
          textAlign: 'center',
          position: 'absolute',
          bottom: 40,
          width: 800
        }}>
          <span style={{
            backgroundColor: '#ffffff',
            display: 'inline-block',
            padding: '4px 16px'
            }} >{format(state.time, "yyyy-MM-dd HH:mm:ss")}</span>
        </div>
      </div>
      
    )
  }
}

export default App;
