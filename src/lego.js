import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { threeToCannon, ShapeType } from 'three-to-cannon'
import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import * as util from './util.js'

export class Lego {
  constructor () {
    this.groups = []

    const loader = new GLTFLoader()
    loader.load("parts.glb", (parts) => {
      loader.load("car.glb", (model) => {
        for (let piece of [...model.scene.children]) {
          const group = new THREE.Group()
          group.add(piece)
          group.position.copy(piece.position)
          group.rotation.copy(piece.rotation)
          piece.position.set(0, 0, 0)
          piece.rotation.set(0, 0, 0)

          this.groups.push(group)
          scene.add(group)
          const name = piece.name.substring(0, piece.name.length - 3)
          const part = parts.scene.getObjectByName(name)

          if (piece.children[0]) {
            piece.children[0].renderOrder = 1
          }

          for (let child of part.children) {
            piece.add(child.clone())
          }

          const collision = piece.children
                .filter(c => c.name.startsWith("collision"))[0]
          piece.add(collision)
          collision.visible = false
          piece.collision = collision
          piece.castShadow = true
          this.createBody(group)
        }
      })
    })
  }

  recenterGroup (group) {
    let children = [...group.children]
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    for (let child of children) {
      child.getWorldPosition(position)
      child.getWorldQuaternion(quaternion)
      scene.add(child)
      child.position.copy(position)
      child.quaternion.copy(quaternion)
    }
    let center = new THREE.Vector3()
    children.forEach(child => center.add(child.position))
    center.divideScalar(children.length)
    group.position.copy(center)
    group.rotation.set(0, 0, 0)
    for (let child of children) {
      group.add(child)
      child.position.sub(center)
    }
  }

  createBody (group) {
    if (group.body) physics.removeBody(group.body)
    this.recenterGroup(group)

    const body = new CANNON.Body({mass: 10.0})
    for (let piece of group.children) {
      const result = threeToCannon(piece.collision, {type: ShapeType.HULL})
      const p = piece.position
      const r = piece.rotation
      const position = new CANNON.Vec3(p.x, p.y, p.z)
      const quaternion = new CANNON.Quaternion().setFromEuler(r.x, r.y, r.z)
      body.addShape(result.shape, position, quaternion)
    }
    body.position.copy(group.position)
    body.quaternion.copy(group.quaternion)
    body.allowSleep = true
    body.sleep()
    body.sleepSpeedLimit = 1
    physics.addBody(body)
    group.body = body
  }

  getPieceAt (position) {
    for (let group of this.groups) {
      for (let piece of group.children) {
        if (util.isInsideObject(piece.collision, position)) {
          return piece
        }
      }
    }
    return null
  }

  getGroupAt (position) {
    return this.getPieceAt(position)?.parent
  }

  snapsMatch (a, b) {
    const aParts = a.name.split("_")
    const bParts = b.name.split("_")
    if (!((aParts[0] === "peg" && bParts[0] === "hole") ||
          (aParts[0] === "hole" && bParts[0] === "peg"))) return false
    if (aParts[1] !== bParts[1]) return false
    return true
  }

  piecesConnected (a, b) {
    const aPosition = new THREE.Vector3()
    const bPosition = new THREE.Vector3()
    for (let aChild of a.children) {
      for (let bChild of b.children) {

        if (this.snapsMatch(aChild, bChild)) {
          aChild.getWorldPosition(aPosition)
          bChild.getWorldPosition(bPosition)

          if (aPosition.distanceTo(bPosition) < 0.05) {
            return true
          }
        }
      }
    }
    return false
  }

  getMovingPieces (group, piece, otherPiece) {
    for (let child of group.children) {
      child.marked = false
    }
    piece.marked = true
    otherPiece.marked = true
    const queue = [otherPiece]
    while (queue.length > 0) {
      const current = queue.shift()
      for (let child of group.children) {
        if (child.marked) {
          continue
        }
        if (this.piecesConnected(current, child)) {
          child.marked = true
          queue.push(child)
        }
      }
    }
    piece.marked = false
    const moving = []
    for (let child of group.children) {
      if (!child.marked) {
        moving.push(child)
      }
    }
    return moving
  }

  grabbed (hand) {
    const controller = avatar.controllers[hand]
    const otherHand = hand === "left" ? "right" : "left"
    const otherController = avatar.controllers[otherHand]

    const position = new THREE.Vector3()
    controller.getWorldPosition(position)

    let group = this.getGroupAt(position)

    if (group) {
      controller.velocityEstimator.setPosition(position)
      if (group.parent === otherController) {
        const piece = this.getPieceAt(position)
        otherController.getWorldPosition(position)
        const otherPiece = this.getPieceAt(position)

        if (piece != otherPiece) {
          const newGroup = new THREE.Group()
          newGroup.position.copy(group.position)
          newGroup.rotation.copy(group.rotation)
          newGroup.matrix.copy(group.matrix)
          newGroup.matrixWorld.copy(group.matrixWorld)

          const otherPiece = this.getPieceAt(position)
          const movingPieces = this.getMovingPieces(group, piece, otherPiece)
          for (let piece of movingPieces) {
            newGroup.add(piece)
          }

          this.groups.push(newGroup)
           group = newGroup
        }
        else {
          otherController.held = null
          otherController.remove(group)
        }
      }

      controller.held = group
      controller.add(group)

      const relativeTransform =
            new THREE.Matrix4()
            .copy(controller.matrixWorld)
            .invert()
            .multiply(group.matrixWorld)

      relativeTransform.decompose(group.position, group.quaternion, group.scale)
      util.pulse(hand, 1, 50)
    }
  }

  canSnap (a, b) {
    if (!this.snapsMatch(a, b)) return false
    const aPosition = new THREE.Vector3()
    const bPosition = new THREE.Vector3()
    a.getWorldPosition(aPosition)
    b.getWorldPosition(bPosition)
    const vector = aPosition.sub(bPosition)

    if (vector.length() < 0.05) {
      const aRotation = new THREE.Quaternion()
      const bRotation = new THREE.Quaternion()
      a.getWorldQuaternion(aRotation)
      b.getWorldQuaternion(bRotation)
      const v1 = new THREE.Vector3(1, 0, 0)
      const v2 = new THREE.Vector3(1, 0, 0)
      v1.applyQuaternion(aRotation)
      v2.applyQuaternion(bRotation)
      const angle = v1.angleTo(v2)
      return util.toDegrees(angle) < 20
    }
    return false
  }

  getClosestTransform (q, transforms) {
    const temp = (q2) => {
      const q3 = q2.clone()
      const coords = ['x', 'y', 'z', 'w']
      coords.forEach(k => q3[k] *= -1)
      return Math.max(q.dot(q2), q.dot(q3))
    }
    transforms.sort(function(a, b) {
      const qa = new THREE.Quaternion()
      util.getQuaternion(a, qa)
      const qb = new THREE.Quaternion()
      util.getQuaternion(b, qb)
      return temp(qb) - temp(qa)
    })
    return transforms[0]
  }

  getSnapTransform (group) {
    for (let otherGroup of this.groups) {
      if (otherGroup === group) continue
      for (let otherChild of otherGroup.children) {
        for (let a of otherChild.children) {
          for (let child of group.children) {
            for (let b of child.children) {
              if (!this.canSnap(a, b)) continue
              const transforms = []
              for (let angle = 0; angle < 360; angle += 90) {
                const transform = new THREE.Matrix4()
                const turn = new THREE.Matrix4()
                transform.multiply(otherChild.matrix)
                transform.multiply(a.matrix)
                turn.makeRotationFromQuaternion(util.aa2q([1, 0, 0, angle]))
                transform.multiply(turn)
                transform.multiply(b.matrix.clone().invert())
                transform.multiply(child.matrix.clone().invert())
                transforms.push(transform)
              }
              const q = otherGroup.getWorldQuaternion(new THREE.Quaternion())
              const q2 = group.getWorldQuaternion(new THREE.Quaternion())
              q.invert().multiply(q2)
              const transform = this.getClosestTransform(q, transforms)
              return {transform, group: otherGroup}
            }
          }
        }
      }
    }
    return null
  }

  weldJoin (a, b, transform) {
    if (a.body) physics.removeBody(a.body)
    a.parent.remove(a)
    this.groups = this.groups.filter(g => g !== a)

    for (let child of [...a.children]) {
      b.add(child)
      child.matrix.premultiply(transform)
      child.matrix.decompose(child.position, child.quaternion, child.scale)
    }
  }

  released (hand) {
    const controller = avatar.controllers[hand]
    const held = controller.held
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()

    if (held) {
      const snap = this.getSnapTransform(held)

      if (snap) {
        this.weldJoin(held, snap.group, snap.transform)
      }
      else {
        held.getWorldPosition(position)
        held.getWorldQuaternion(quaternion)
        scene.add(held)
        held.position.copy(position)
        held.quaternion.copy(quaternion)
        this.createBody(held)

        const velocity = new THREE.Vector3()
        held.body.position.copy(held.position)
        held.body.quaternion.copy(held.quaternion)
        velocity.set(...controller.velocityEstimator.getVelocity())
        velocity.multiplyScalar(120)
        held.body.velocity.set(velocity.x, velocity.y, velocity.z)
        held.body.angularVelocity.set(0, 0, 0)
        held.body.wakeUp()
      }
      controller.held = null
    }
  }

  update = (() => {
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const left = avatar.controllers.left
    const right = avatar.controllers.right

    return function() {
      for (let group of this.groups) {
        if (group.body) {
          if (group.parent === left || group.parent === right) {
            group.getWorldPosition(position)
            group.getWorldQuaternion(quaternion)
            group.parent.velocityEstimator.recordPosition(position)

            group.body.position.copy(position)
            group.body.quaternion.copy(quaternion)
          }
          else {
            if (group.body.position.y < -10) {
              group.body.position.set(0, 10, 0)
              group.quaternion.set(0, 0, 0, 1)
              group.body.velocity.set(0, 0, 0)
              group.body.angularVelocity.set(0, 0, 0)
            }

            group.position.copy(group.body.position)
            group.quaternion.copy(group.body.quaternion)
          }
        }
      }
    }
  })()
}
