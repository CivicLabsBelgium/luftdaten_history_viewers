import React from "react"
import { BrowserRouter as Router, Route, Redirect } from "react-router-dom"
import Map from './Map'
import Hotspot from './Hotspot'

function AppRouter() {
  return (
    <Router>
      <Route exact path="/history_map/" render={() => <Redirect to='/history_map/map' />} />
      <Route path="/history_map/map" component={Map} />
      <Route path="/history_map/hotspot" component={Hotspot} />
    </Router>
  )
}

export default AppRouter