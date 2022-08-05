import React from 'react';
import './login.css';
import { AUTH_DOMAIN } from '@harxer/seam-lib';
import { login } from '@harxer/session-manager-lib';

class Login extends React.Component {

  constructor(props) {
    super(props)

    this.state = {
      user: '',
      pwd: '',
      loggingIn: false
    }

    this.handleUserInput = this.handleUserInput.bind(this);
    this.handlePasswordInput = this.handlePasswordInput.bind(this);

    this.handleSubmit = this.handleSubmit.bind(this);
  }

  handleUserInput(event) {
    this.setState({user: event.target.value});
  }
  handlePasswordInput(event) {
    this.setState({pwd: event.target.value});
  }

  handleSubmit() {
    const { user, pwd } = this.state

    this.setState({loggingIn: true})

    login(AUTH_DOMAIN, user, pwd).then(_ => {
      this.props.handleLogin()
    }).catch(err => {
      this.setState({loggingIn: false})
    })
  }

  handlePasswordKeyPress(e) {
    if(e.key === 'Enter'){
      this.handleSubmit()
    }
  }

  render() {
    const { user, pwd, loggingIn } = this.state

    return (
      <div id='login'>
        <div>
          <div className='logo'/>
          <input disabled={loggingIn} className='txt user' placeholder='User' type='text' value={user} onChange={this.handleUserInput} />
          <input disabled={loggingIn} className='txt pwd' placeholder='Password' type='password' value={pwd} onChange={this.handlePasswordInput} onKeyPress={(e) => this.handlePasswordKeyPress(e)}/>
          <button disabled={loggingIn} className='submit' onClick={this.handleSubmit}>{loggingIn ? 'Logging in...' : 'Login'}</button>
        </div>
      </div>
    );
  }
}

export default Login;
