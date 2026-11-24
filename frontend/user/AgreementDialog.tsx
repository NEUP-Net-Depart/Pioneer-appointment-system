import { DialogLayer, useDialogs } from './dialogs';

export function AgreementDialog() {
  const { close } = useDialogs();
  return (
    <DialogLayer kind="agreement" id="agreement-modal">
      <section
        data-track="student.index.section.54"
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agreement-title"
      >
        <h2 id="agreement-title">先锋网络中心先锋维修知情同意书</h2>
        <p>实施时间：2025年3月1日</p>
        <div className="modal-body">
          <p>
            为向东北大学师生更好地提供计算机维修服务，避免不必要的纠纷以及损失，先锋网络中心（以下简称“中心”）现声明如下。
            <b>如果您继续要求维修，则视为您已全文阅读并同意以下内容。</b>
          </p>
          <p>一、对于以下情况，中心有权拒绝提供维修服务或中止维修服务：</p>
          <p>&nbsp;&nbsp;1.故障设备的维修难度过大、技术过于复杂，维修成功率过低的；</p>
          <p>&nbsp;&nbsp;2.其故障设备的维修成本过高，甚至高于重新购置设备的；</p>
          <p>&nbsp;&nbsp;3.其设备存在不可逆损坏或运用现有技术无法修复的；</p>
          <p>&nbsp;&nbsp;4.其故障设备过于贵重的；</p>
          <p>&nbsp;&nbsp;5.提出的维修要求过于严苛，或出现双方沟通无法达成一致的；</p>
          <p>&nbsp;&nbsp;6.提出维修申请方未如实告知故障机器的全部故障情况的；</p>
          <p>&nbsp;&nbsp;7.其它不适合维修的情况的。</p>
          <p>
            二、设备维修过程中需要的部分配件及耗材需由维修申请人自行准备，中心将不会直接提供配件或提出购买建议。
          </p>
          <p>
            三、在维修过程中，如果出现非中心维修人员直接导致的设备意外损坏，中心不承担维修及赔偿责任。
          </p>
          <p>四、本文最终解释权归中心所有，其他未尽事宜由中心负责解释。</p>
          <p>
            <b>先锋网络中心将用心用情为同学们提供更有品质的服务。</b>
          </p>
        </div>
        <button
          data-track="student.index.button.55"
          className="primary-btn"
          id="close-agreement"
          type="button"
          onClick={close}
        >
          关闭阅读
        </button>
      </section>{' '}
    </DialogLayer>
  );
}
