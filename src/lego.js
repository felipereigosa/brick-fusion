import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three';
import * as util from './util.js';

export class Lego {
  constructor (scene, avatar) {
    this.scene = scene;
    this.avatar = avatar;
    this.groups = [];

    this.collisionBox = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial()
    );
    this.collisionBox.visible = false;

    const loader = new GLTFLoader();
    loader.load("model.glb", (gltf) => {
      for (let piece of [...gltf.scene.children]) {
        const group = new THREE.Group();
        piece.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.computeBoundingBox();
          }
        });
        group.add(piece);
        group.position.copy(piece.position);
        group.rotation.copy(piece.rotation);
        piece.position.set(0, 0, 0);
        piece.rotation.set(0, 0, 0);
        this.groups.push(group);
        scene.add(group);
      }
    });
  }

  getPieceAt (position) {
    for (let group of this.groups) {
      for (let piece of group.children) {
        if (piece instanceof THREE.Mesh) {
          const box = piece.geometry.boundingBox;
          piece.getWorldPosition(this.collisionBox.position);
          piece.getWorldQuaternion(this.collisionBox.quaternion);
          this.collisionBox.scale.copy(box.max).sub(box.min);
          this.collisionBox.scale.multiplyScalar(1.2);
          if (util.isInsideObject(this.collisionBox, position)) {
            return piece;
          }
        }
      }
    }
    return null;
  }

  getGroupAt (position) {
    return this.getPieceAt(position)?.parent;
  }

  grabbed (hand) {
    const controller = this.avatar.controllers[hand];
    // const otherHand = hand === "left" ? "right" : "left";
    // const otherController = avatar.controllers[otherHand];

    const position = new THREE.Vector3();
    controller.getWorldPosition(position);

    let group = this.getGroupAt(position);

    if (group) {
      //   if (group.parent === otherController) {
      //     const newGroup = new THREE.Group();
      //     newGroup.position.copy(group.position);
      //     newGroup.rotation.copy(group.rotation);
      //     newGroup.matrix.copy(group.matrix);
      //     newGroup.matrixWorld.copy(group.matrixWorld);

      //     const piece = getPieceAt(position);
      //     otherController.getWorldPosition(position);
      //     const otherPiece = getPieceAt(position);
      //     const movingPieces = getMovingPieces(group, piece, otherPiece);
      //     for (let piece of movingPieces) {
      //       newGroup.add(piece);
      //     }

      //     this.groups.push(newGroup);
      //     createBody(newGroup);
      //     createBody(group);
      //     group = newGroup;
      //   }

      controller.held = group;
      controller.add(group);

      const relativeTransform =
            new THREE.Matrix4()
            .copy(controller.matrixWorld)
            .invert()
            .multiply(group.matrixWorld);

      relativeTransform.decompose(group.position, group.quaternion, group.scale);
      // pulse(hand, 1, 50); //############################################################################################################
      // wakeUp();
    }
  }

  getClosestTransform (q, transforms) {
    function temp (q2) {
      const q3 = q2.clone();
      q3.x *= -1;
      q3.y *= -1;
      q3.z *= -1;
      q3.w *= -1;

      return Math.max(q.dot(q2), q.dot(q3));
    };

    transforms.sort(function(a, b) {
      return temp(b.rotation) - temp(a.rotation);
    });

    return transforms[0];
  }

  getSnapTransform (group) {
    const pegPosition = new THREE.Vector3();
    const holePosition = new THREE.Vector3();

    for (let otherGroup of this.groups) {
      if (otherGroup === group) {
        continue;
      }

      const q2 = group.getWorldQuaternion(new THREE.Quaternion());
      const q = otherGroup.getWorldQuaternion(new THREE.Quaternion());
      q.invert();
      q.multiply(q2);

      // q is the local rotation of the released group in the frame of the other group (to be compared with the 4 rotations below)

      // console.log([">>> q2 = ", q2.x, q2.y, q2.z, q2.w]);
      // console.log([">>> q = ", q.x, q.y, q.z, q.w]);

      for (let otherChild of otherGroup.children) {
        for (let p of otherChild.children.filter(c => c.name.startsWith("peg"))) {
          for (let child of group.children) {
            for (let h of child.children.filter(c => c.name.startsWith("hole"))) {
              p.getWorldPosition(pegPosition); //########################################
              h.getWorldPosition(holePosition); //#######################################
              const vector = pegPosition.sub(holePosition);

              // console.log([child.name, otherChild.name, vector.length()]);
              if (vector.length() < 0.1) {

                const transforms = [];
                for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 2) {
                  const position = new THREE.Vector3();
                  const rotation = new THREE.Quaternion();
                  const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(angle, 0, 0));

                  rotation.copy(p.quaternion);
                  rotation.multiply(turn);
                  const hRotation = h.quaternion.clone(); //################
                  hRotation.invert();
                  rotation.multiply(hRotation);

                  const hPosition = h.position.clone(); //################
                  hPosition.applyQuaternion(rotation);
                  position.copy(p.position);
                  position.sub(hPosition);
                  transforms.push({angle, position, rotation, group: otherGroup});
                  // console.log(["angle >>>", angle, rotation.x, rotation.y, rotation.z, rotation.w]);
                  // instead of storing transforms, use quaternionEquals here and return if close enough? ##################################
                }
                const transform = this.getClosestTransform(q, transforms);
                // console.log(["found transform", transform]);
                return transform;
              }
            }
          }
        }
      }
    }
    return null;
  }

  weld (a, b, position, rotation) {
    // physics.removeBody(a.body);

    a.parent.remove(a);
    this.groups = this.groups.filter(g => g !== a);

    for (let child of [...a.children]) {
      b.add(child);
      const transform = new THREE.Matrix4();
      transform.compose(position, rotation, new THREE.Vector3(1, 1, 1));
      transform.multiply(child.matrix);
      const scale = new THREE.Vector3();
      transform.decompose(child.position, child.quaternion, scale);
    }

    // createBody(b);
  }

  released (hand) {
    const controller = this.avatar.controllers[hand];
    const held = controller.held;

    if (held) {
      const snap = this.getSnapTransform(held);

      if (snap) {
        this.weld(held, snap.group, snap.position, snap.rotation);
      }
      else {
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        held.getWorldPosition(position);
        held.getWorldQuaternion(quaternion);
        this.scene.add(held);
        held.position.copy(position);
        held.quaternion.copy(quaternion);

        // held.body.position.copy(held.position);
        // held.body.quaternion.copy(held.quaternion);
        // velocity.set(...controller.velocityEstimator.getVelocity());
        // velocity.multiplyScalar(120);
        // held.body.velocity.set(velocity.x, velocity.y, velocity.z);
        // held.body.angularVelocity.set(0, 0, 0);
        // wakeUp();
      }
      controller.held = null;
    }
  }
}
