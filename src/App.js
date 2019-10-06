import React from "react"
import { BrowserRouter as Router, Route, Redirect } from "react-router-dom"
import Map from './Map'
import Hotspot from './Hotspot'

function AppRouter() {
  return (
    <Router>
        <Route exact path="/" render={() => <Redirect to='/map' />} />
        <Route path="/map" component={Map} />
        <Route path="/hotspot" component={Hotspot} />
    </Router>
  )
}

export default AppRouter