import {
  type CollisionDetection,
  pointerWithin,
  rectIntersection,
  useDroppable,
} from "@dnd-kit/core";

export function useIssueDropTarget(
  id: string,
  priority: number | string | null,
) {
  const { setNodeRef: setRegionRef } = useDroppable({
    id: `${id}-region`,
    data: { type: "BucketRegion", targetId: id },
  });
  const { isOver, setNodeRef: setContentRef } = useDroppable({
    id,
    data: { type: "Bucket", priority },
  });

  return { isOver, setRegionRef, setContentRef };
}

// Keep the whole column (including its header) as the hit area, while the
// inner target lets dnd-kit discover the column's scrollable ancestor.
export const detectIssueDrop: CollisionDetection = (arguments_) => {
  const regions = arguments_.droppableContainers.filter(
    (container) => container.data.current?.type === "BucketRegion",
  );
  const detectCollision = arguments_.pointerCoordinates
    ? pointerWithin
    : rectIntersection;

  return detectCollision({
    ...arguments_,
    droppableContainers: regions,
  }).flatMap((collision) => {
    const targetId = collision.data?.droppableContainer.data.current?.targetId;
    const target = arguments_.droppableContainers.find(
      (container) => container.id === targetId,
    );

    return target
      ? [
          {
            ...collision,
            id: target.id,
            data: { ...collision.data, droppableContainer: target },
          },
        ]
      : [];
  });
};
