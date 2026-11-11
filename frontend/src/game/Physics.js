export class Physics {
  static async create() {
    const { default: RAPIER } = await import('@dimforge/rapier3d');
    return new Physics(RAPIER);
  }

  constructor(RAPIER) {
    this.RAPIER = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: -18, z: 0 });
    this.controller = this.world.createCharacterController(0.02);
    this.controller.setSlideEnabled(true);
    this.controller.setMaxSlopeClimbAngle(Math.PI / 4);
    this.controller.enableAutostep(0.32, 0.2, true);
    this.controller.enableSnapToGround(0.25);
  }

  addFixedBox(center, size) {
    const body = this.world.createRigidBody(
      this.RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z),
    );
    const collider = this.RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
      .setFriction(0.9);
    return { body, collider: this.world.createCollider(collider, body) };
  }

  removeFixedBox(handle) {
    if (handle) this.world.removeRigidBody(handle.body);
  }

  createCharacter(position) {
    const body = this.world.createRigidBody(
      this.RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(position.x, position.y, position.z)
        .lockRotations(),
    );
    const collider = this.world.createCollider(
      this.RAPIER.ColliderDesc.capsule(0.55, 0.3).setFriction(0),
      body,
    );
    return { body, collider };
  }

  moveCharacter(body, collider, desiredTranslation, delta) {
    this.controller.computeColliderMovement(collider, desiredTranslation);
    const movement = this.controller.computedMovement();
    const position = body.translation();
    body.setNextKinematicTranslation({
      x: position.x + movement.x,
      y: position.y + movement.y,
      z: position.z + movement.z,
    });
    this.world.timestep = delta;
    this.world.step();
    return this.controller.computedGrounded();
  }

  destroy() {
    this.controller.free();
    this.world.free();
  }
}