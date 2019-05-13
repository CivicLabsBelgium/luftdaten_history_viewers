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
import { isSunday } from 'date-fns/esm';


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

const noColoursStyle = new Style({
  fill: new Fill({
    color: 'rgba(0, 0, 0, 0)'
  })
})

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
      fetchDateProgress: 0,
      fetchTilesProgress: 0,
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
        const availableDays = myJson.map(day => Date.parse(day))
        this.setState({
          availableDays
        })
        this.setStartDate(availableDays[availableDays.length - 1])
      })
  }
  setPosition(position) {
    this.setState({
      position
    })
  }
  getDataForDate (date) {
    const phenomenom = this.state.phenomenom
    let luftdatenTiles = this.state.luftdatenTiles
    return new Promise(async (resolve, reject) => {
      // fetch available locations for this date
      const response = await fetch(`https://history.influencair.be/availableLocations/${date}`)
      const availableTiles = await response.json()
      // filter out tiles that don't exist
      luftdatenTiles = luftdatenTiles.filter(tile => availableTiles.includes(tile))
      // to prevent to much concurrent calls to the server divide tiles into groups of 5
      luftdatenTiles = luftdatenTiles.reduce((acc, tile, index) => {
        (acc[Math.floor(index / 5)] = acc[Math.floor(index / 10)] || []).push(tile)
        return acc
      },[])
      
      const result = []
      let fetchCounter = 1
      for (const tileGroup of luftdatenTiles) {
        const promises = tileGroup.map(position => fetch(`https://history.influencair.be/${phenomenom}/${position}/${date}/data.json`).then(response => {
          if (response.status === 200) {
            return response.json()
          } else {
            return []
          }
        }))
        let results = await Promise.all(promises)
        for (const response of results) {
          result.push(...response)
        }
        results = []
        this.setState({
          fetchTilesProgress: fetchCounter / luftdatenTiles.length
        })
      }
      resolve(result)
    })
  }
  async getData (){
    this.setState({
      stopPlayer: true,
      data: [],
      parsing: false,
      fetching: true,
    })
    let data =  []
    let fetchCounter = 1
    const dates = this.state.dates
    
    for (const date of dates) {
      const newData = await this.getDataForDate(date)
      if (data.length === 0) {
        data = newData
      } else {
        data = this.mergeDataDays(data, newData)
      }
      this.setState({
        fetchDateProgress: fetchCounter / dates.length,
        fetchTilesProgress: 0
      })
      fetchCounter++
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
      renderer: 'webgl',
      layers: [
        new TileLayer({
          source: new XYZ({
            url: 'https://api.mapbox.com/styles/v1/appsaloon/cjvmj8i920d8z1elctn0ofdv7/tiles/256/{z}/{x}/{y}?access_token=pk.eyJ1IjoiYXBwc2Fsb29uIiwiYSI6ImNpaGMwN2p2ZTEweHN2MGtpMm5lNnkxcmQifQ.vNd3He7Merax-vnWQS_ZTQ'
          })
        }),
        new TileLayer({
          source: new XYZ({
            //url: 'https://maps.luftdaten.info/tiles/{z}/{x}/{y}.png',
            //url: 'https://api.tiles.mapbox.com/v4/mapbox.streets/{z}/{x}/{y}.png?access_token=pk.eyJ1IjoiYXBwc2Fsb29uIiwiYSI6ImNpaGMwN2p2ZTEweHN2MGtpMm5lNnkxcmQifQ.vNd3He7Merax-vnWQS_ZTQ'
            //url: 'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'
            //url: 'https://tiles.wmflabs.org/bw-mapnik/{z}/{x}/{y}.png'
            url: 'https://api.mapbox.com/styles/v1/appsaloon/cj3tqlivy00002sq88o3vzsgr/tiles/256/{z}/{x}/{y}?access_token=pk.eyJ1IjoiYXBwc2Fsb29uIiwiYSI6ImNpaGMwN2p2ZTEweHN2MGtpMm5lNnkxcmQifQ.vNd3He7Merax-vnWQS_ZTQ'
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
      console.log('resolution: ', resolution, 'hexbinSize: ', this.resolutionToHexbinSize(resolution))
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
    const maxSize = [300, 6500]
    return (((maxSize[1] - minSize[1]) / (maxSize[0] - minSize[0])) * (resolution - minSize[0])) + minSize[1]
  }
  parseData () {
    const state = this.state
    let sensors = state.data
    if (!sensors || sensors.length === 0) return
    this.setState({
      parsing: true
    })

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
  }
  prepareLayers () {
    console.log('preparing layers')
    const state = this.state
    const time = state.time
    const mapLayers = map.getLayers().getArray()
    const geoJsonObject = state.geoJsonObject
    if (!geoJsonObject || (geoJsonObject && geoJsonObject.length === 0)) return

    const vectorSource = new VectorSource({
      features: (new GeoJSON()).readFeatures(geoJsonObject)
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
          return f.get('values')[time]
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

    mapLayers.forEach(layer => {
      if (layer.get('name') === 'timeSerie') map.removeLayer(layer)
    })
    state.map.addLayer(vectorLayer)
    this.playData()
  }
  startPlaying() {
    this.setState({
      stopPlayer: false
    })
    // it only works when I do this crazy setTimeout function
    setTimeout(() => {
      this.playData()
    },100)
    
  }
  stopPlaying() {
    this.setState({
      stopPlayer: true
    })
  }
  playData () {
    const state = this.state
    const map = state.map
    const mapLayers = map.getLayers().getArray()
    const timeZoneOffset = state.position[1] * 24 / 360
    const sun = SunCalc.getPosition(addHours(state.time, timeZoneOffset), state.position[0], state.position[1]).altitude
    const tileOpacity = Math.min(Math.max(0.3 + ((sun * 2) - sun), 0),1)
    mapLayers[1].setOpacity(tileOpacity)
    
    mapLayers.forEach(layer => {
      if (layer.get('name') === 'timeSerie') {
        layer.setStyle(feature => {
          const features = feature.get('features')
          const mean = features.reduce((acc,f) => {
            const v = f.get('values')[state.time]
            if (v) acc.push(v)
            return acc
          },[])
          
          let value
          if (mean.length === 0) {
              value = 0
          } else if (mean.length === 1) {
            value = mean[0] || 0
          } else if (mean.length === 2) {
            value = (mean[0] + mean[1])/2
          } else if (mean.length > 2) {
            mean.sort()
            value = mean[parseInt(mean.length / 2)]
          } else {
            console.log(mean)
          }
          return value ? getStyleForMean(value).style : noColoursStyle
        })
      }
    })

    if (!state.stopPlayer) {
      setTimeout(() => {
        this.setState({
          time: (state.time + state.interval < state.end) ? state.time + state.interval : state.start
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
          geoJsonObject: event.data.geoJsonObject,
          parsing: false,
          fetching: false,
          parsingProgress: 0,
          fetchDateProgress: 0,
          fetchTilesProgress: 0,
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
    const parsingProgress = state.parsingProgress * 100
    const fetchingProgress = (state.fetchDateProgress + (state.fetchTilesProgress / state.dates.length)) * 100

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
        <div className="form row">
          <div className="column">
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
            <label>Interval (min):<input type="number" min="10" max="120" step="10" defaultValue={state.interval / (1000 * 60)} onChange={(e) => this.setState({interval: e.target.value * 1000 * 60})}/></label>
            <button onClick={() => this.getData()}>Get data</button>
          </div>
          <div className="column">
            <label>Frames per second :<input type="number" min="1" max="15" step="1" defaultValue={state.framesPerSecond} onChange={(e) => this.setState({framesPerSecond: e.target.value})}/></label>

            {state.fetching && fetchingProgress ? 
              <div style={{
                width: '100%',
                height: 8,
                marginBottom: 4
              }}
              >
                <div style={{
                  width: fetchingProgress + '%',
                  backgroundColor: 'red',
                  height: 8,
                  float: 'left',
                }}></div>
              </div>
            : 
              null
            }
            {state.parsing && parsingProgress ? 
              <div style={{
                width: '100%',
                height: 8,
                marginBottom: 4
              }}
              >
                <div style={{
                  width: parsingProgress + '%',
                  backgroundColor: 'red',
                  height: 8,
                  float: 'left',
                }}></div>
              </div>
            : 
              null
            }
            {state.stopPlayer ?
              <button onClick={() => {this.startPlaying()}}>play</button>
            :
              <button onClick={() => {this.stopPlaying()}}>pauze</button>
            }
          </div>
        </div>
        
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
