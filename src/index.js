import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { BoxLineGeometry } from 'three/addons/geometries/BoxLineGeometry.js'
import { VRButton } from 'three/addons/webxr/VRButton.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { VelocityEstimator } from "./velocity.js"
import * as util from './util.js'
import { Lego } from './lego'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

let camera
let renderer
let entered
let lego
let controls

const buttonNames = ["trigger", "grab", "", "thumbstick", "x", "y", ""]
let oldState = {left: {buttons: [0, 0, 0, 0, 0, 0, 0], axes: [0, 0]},
                right: {buttons: [0, 0, 0, 0, 0, 0, 0], axes: [0, 0]}}

function getAxes (hand) {
  return oldState[hand].axes
}

function pollControllers () {
  const session = renderer.xr.getSession()
  if (session) {
    for (const source of session.inputSources) {
      if (source.gamepad) {
        const controller = avatar.controllers[source.handedness]
        if (!controller.actuator) {
          controller.actuator = source.gamepad.hapticActuators[0]
        }
        const buttons = source.gamepad.buttons.map((b) => b.value)
        for (let i = 0; i < 7; i++) {
          if (buttons[i] > 0.5 && oldState[source.handedness].buttons[i] < 0.5) {
            try {
              buttonPressed(source.handedness, buttonNames[i])
            }
            catch (error) {
              console.log(`input error ${error}`)
            }
          }
          else if (buttons[i] === 0 &&
                   oldState[source.handedness].buttons[i] !== 0) {
            try {
              buttonReleased(source.handedness, buttonNames[i])
            }
            catch (error) {
              console.log(`input error ${error}`)
            }
          }
        }
        oldState[source.handedness].buttons = [...buttons]
        oldState[source.handedness].axes = source.gamepad.axes.slice(2)
      }
    }
  }
}

function createStaticBody (x, y, z, hw, hh, hd) {
  const shape = new CANNON.Box(new CANNON.Vec3(hw, hh, hd))
  const body = new CANNON.Body({mass: 0})
  body.addShape(shape)
  body.position.set(x, y, z)
  physics.addBody(body)
}

function playAction (object, actionName, timeScale) {
  const mixer = object.mixer
  const clip = THREE.AnimationClip.findByName(object.clips, actionName)
  const action = mixer.clipAction(clip, object)
  mixer.stopAllAction()
  action.reset()
  action.timeScale = timeScale
  action.loop = THREE.LoopOnce
  action.clampWhenFinished = true
  action.play()
}

function createEnvironment () {
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.6)
  hemiLight.position.set(0, 50, 0)
  scene.add(hemiLight)

  const dirLight = new THREE.DirectionalLight(0xffffff, 1)
  dirLight.color.setHSL(0.1, 1, 0.95)
  dirLight.position.set(1, 1.75, 0)
  dirLight.position.multiplyScalar(30)
  scene.add(dirLight)
  dirLight.castShadow = true
  dirLight.shadow.mapSize.width = 4096 * 4
  dirLight.shadow.mapSize.height = 4096 * 4
  const d = 6
  dirLight.shadow.camera.left = - d
  dirLight.shadow.camera.right = d
  dirLight.shadow.camera.top = d
  dirLight.shadow.camera.bottom = -d
  dirLight.shadow.camera.far = 500

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(12, 12),
                                new THREE.MeshLambertMaterial({color: 0xaaaaaa}))
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)

  const room = new THREE.LineSegments(
    new BoxLineGeometry(12, 12, 12, 20, 20, 20),
    new THREE.LineBasicMaterial({color: 0x808080})
  )
  room.geometry.translate(0, 6.001, 0)
  scene.add(room)

  const vertexShader = `varying vec3 vWorldPosition;
                        void main() {
                          vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
                          vWorldPosition = worldPosition.xyz;
                          gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
                        }`

  const fragmentShader = `uniform vec3 topColor;
                          uniform vec3 bottomColor;
                          uniform float offset;
                          uniform float exponent;
                          varying vec3 vWorldPosition;
                          void main() {
                            float h = normalize( vWorldPosition + offset ).y;
                            gl_FragColor = vec4( mix( bottomColor, topColor, max( pow( h, exponent ), 0.0 ) ), 1.0 );
                          }`

  const c = new THREE.Color(0xffffff)
  c.setHSL(0.6, 1, 0.6)
  const uniforms = {
    'topColor': {value: c},
    'bottomColor': {value: new THREE.Color(0xffffff)},
    'offset': {value: 500},
    'exponent': {value: 0.6}
  }
  scene.fog.color.copy(uniforms['bottomColor'].value)

  const skyGeo = new THREE.SphereGeometry(4000, 32, 15)
  const skyMat = new THREE.ShaderMaterial({
    uniforms: uniforms,
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    side: THREE.BackSide
  })

  const sky = new THREE.Mesh(skyGeo, skyMat)
  scene.add(sky)

  createStaticBody(0, -0.1, 0, 6, 0.1, 6)
  createStaticBody(0, 6, -6.1, 6, 6, 0.1)
  createStaticBody(0, 6, 6.1, 6, 6, 0.1)
  createStaticBody(-6.1, 6, 0, 0.1, 6, 6)
  createStaticBody(6.1, 6, 0, 0.1, 6, 6)
}

function init () {
  try {
    entered = false
    window.scene = new THREE.Scene()
    scene.background = new THREE.Color().setHSL( 0.6, 0, 1 )
    scene.fog = new THREE.Fog( scene.background, 1, 5000 )
    window.avatar = new THREE.Group()
    const width = window.innerWidth
    const height = window.innerHeight
    camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 5000)
    camera.position.set(0, 1, 4)
    avatar.clock = new THREE.Clock()

    avatar.add(camera)
    avatar.controllers = {}
    avatar.speed = 0.03
    avatar.position.y = -0.5
    scene.add(avatar)

    window.physics = new CANNON.World()
    physics.gravity.set(0, -9.82, 0)
    physics.allowSleep = true

    createEnvironment()

    renderer = new THREE.WebGLRenderer({antialias: true})
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.xr.enabled = true
    renderer.shadowMap.enabled = true
    document.body.appendChild(renderer.domElement)
    renderer.xr.addEventListener('sessionstart', () => {
      entered = true
    })

    controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 1, 0)

    document.body.appendChild(VRButton.createButton(renderer))

    const leftController = renderer.xr.getControllerGrip(0)
    leftController.name = 'left_controller'
    leftController.velocityEstimator = new VelocityEstimator()
    avatar.add(leftController)
    avatar.controllers['left'] = leftController

    const rightController = renderer.xr.getControllerGrip(1)
    rightController.name = 'right_controller'
    rightController.velocityEstimator = new VelocityEstimator()
    avatar.add(rightController)
    avatar.controllers['right'] = rightController

    const loader = new GLTFLoader()
    loader.load("hand.glb",
                function (gltf) {
                  const rightHand = gltf.scene
                  rightHand.name = 'right_hand'
                  rightController.add(rightHand)
                  rightHand.clips = gltf.animations
                  rightHand.mixer = new THREE.AnimationMixer(gltf.scene)
                  rightHand.scale.set(0.95, 0.95, 0.95)

                  rightHand.traverse(function (child) {
                    if (child.isMesh) child.castShadow = true
                  })

                  const leftHand = util.clone(rightHand)
                  leftHand.name = 'left_hand'
                  leftHand.scale.set(-0.95, 0.95, 0.95)
                  leftHand.clips = gltf.animations
                  leftHand.mixer = new THREE.AnimationMixer(gltf.scene)
                  leftController.add(leftHand)

                  renderer.setAnimationLoop(render)
                })

    lego = new Lego()
  }
  catch (error) {
    console.log(`init error ${error}`)
  }
}

function move () {
  const direction = new THREE.Vector3()
  const [lx, lz] = getAxes("left")
  direction.set(lx, 0, lz)

  if (direction.length() > 0.1) {
    direction.applyEuler(camera.rotation)
    direction.applyEuler(avatar.rotation)
    direction.y = 0
    direction.normalize()
    direction.multiplyScalar(avatar.speed)
    avatar.position.add(direction)
  }

  avatar.position.x = util.within(avatar.position.x, -5.5, 5.5)
  avatar.position.z = util.within(avatar.position.z, -5.5, 5.5)
}

let thumb = false
function turn () {
  const value = getAxes("right")[0]
  const angleSize = util.toRadians(45)
  if (value > 0.9 && !thumb) {
    thumb = true
    avatar.rotation.y -= angleSize
  }
  else if (value < -0.9 && !thumb) {
    thumb = true
    avatar.rotation.y += angleSize
  }
  else if (value === 0) {
    thumb = false
  }
}

let thumb2 = false
function adjustHeight () {
  const value = getAxes("right")[1]
  if (value > 0.9 && !thumb2) {
    thumb2 = true
    avatar.position.y = util.within(avatar.position.y - 0.5, -0.5, 11.5)
  }
  else if (value < -0.9 && !thumb2) {
    thumb2 = true
    avatar.position.y = util.within(avatar.position.y + 0.5, -0.5, 11.5)
  }
  else if (value === 0) {
    thumb2 = false
  }
}

function buttonPressed (hand, button) {
  const handMesh = avatar.getObjectByName(`${hand}_hand`)
  if (button === "grab") {
    playAction(handMesh, "close", 3)
    lego.grabbed(hand)
  }
}

function buttonReleased (hand, button) {
  const handMesh = avatar.getObjectByName(`${hand}_hand`)
  if (button === "grab") {
    playAction(handMesh, "open", 3)
    lego.released(hand)
  }
}

const position = new THREE.Vector3()
const quaternion = new THREE.Quaternion()
function render () {
  try {
    renderer.render(scene, camera)

    if (entered) {
      physics.fixedStep()
      pollControllers()
      move()
      turn()
      adjustHeight()

      const delta = avatar.clock.getDelta()
      const rightHand = scene.getObjectByName("right_hand")
      rightHand.mixer.update(delta)
      const leftHand = scene.getObjectByName("left_hand")
      leftHand.mixer.update(delta)

      lego.update()
    }
    else {
      controls.update()
    }
  }
  catch (error) {
    console.log(`render error ${error}`)
  }
}

init()
