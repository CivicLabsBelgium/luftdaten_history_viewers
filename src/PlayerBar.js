import React from 'react'

class PlayerBar extends React.Component {
    constructor (props) {
        super(props)
        this.state = {
            dragging: false,
            position: 0,
            lenghtOfPlayer: null,
            rel: null,
            pos: null
        }

        this.onMouseDown = this.onMouseDown.bind(this)
        this.onMouseUp = this.onMouseUp.bind(this)
        this.onMouseMove = this.onMouseMove.bind(this)

        this.slider = React.createRef()
    }
    onMouseDown(e) {
        if (e.button !== 0) return
        const posPlayer = this.slider.current.getBoundingClientRect()
        const lenghtOfPlayer = this.slider.current.offsetWidth
        this.setState({
            dragging: true,
            lenghtOfPlayer,
            rel: e.pageX - posPlayer.x
        })
        e.stopPropagation()
        e.preventDefault()
    }
    onMouseUp (e) {
        this.setState({dragging: false})
        e.stopPropagation()
        e.preventDefault()
    }
    onMouseMove (e) {
        if (!this.state.dragging) return
        const posPlayer = this.slider.current.getBoundingClientRect()
        const pos = e.pageX - posPlayer.x
        let position = (pos / this.state.lenghtOfPlayer) * 100
        position = position >= 100 ? 100 : position
        position = position <= 0 ? 0 : position
        if (typeof this.props.onChange === 'function') {
            this.props.onChange(position)
        }
        this.setState({
            pos,
            position
        })
        e.stopPropagation()
        e.preventDefault()
    }
    componentDidUpdate (props, state) {
        if (this.state.dragging && !state.dragging) {
            document.addEventListener('mousemove', this.onMouseMove)
            document.addEventListener('mouseup', this.onMouseUp)
        } else if (!this.state.dragging && state.dragging) {
            document.removeEventListener('mousemove', this.onMouseMove)
            document.removeEventListener('mouseup', this.onMouseUp)
        }
    }
    componentWillReceiveProps (nextProps) {
        if (this.state.position !== nextProps.position) {
            this.setState({
                position: nextProps.position
            })
        }   
    }
    render () {
        return (
            <div style={{
                backgroundColor: '#4a4a4a', 
                height: 8,
                width: 768,
                position: 'absolute',
                bottom: 16,
                left: 16,
                borderRadius: 4
              }}
              ref={this.slider}>
              <div style={{
                width: `${this.state.position}%`,
                float: 'left',
                height: 8,
                backgroundColor: '#74b6e6',
                borderRadius: 4,
                position: 'relative'
              }}>
                <div style={{
                  width: 12,
                  height: 12,
                  position: 'absolute',
                  right: -8,
                  top: -4,
                  backgroundColor:'#fff',
                  borderRadius: 8,
                  borderColor: '#142d40',
                  borderWidth: 2,
                  borderStyle: 'solid',
                  cursor: 'pointer'
                }}
                onMouseDown={this.onMouseDown}></div>
              </div>
            </div>
        )
    }
}

export default PlayerBar